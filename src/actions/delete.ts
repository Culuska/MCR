"use server";

import { revalidatePath } from "next/cache";
import { assertExpense, assertInvoice, assertProject, assertRecord, scopeOf } from "@/lib/scope";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { APPROVERS } from "@/lib/permissions";
import { KINDS, dependents, isKind, type Kind } from "@/lib/deletion";
import { formObject, run, type FormState } from "@/lib/action";
import type { Role } from "@/generated/prisma/enums";

const schema = z.object({ kind: z.string(), id: z.string().min(1), reason: z.string().trim().min(3, "Give a short reason, at least 3 characters.").max(300) });

type Found = { label: string; row: object; counts: Record<string, number>; problem?: string; cleanup?: () => Promise<unknown> };

// Looks the record up and says what, if anything, stops it being deleted.
async function inspect(tx: Tx, kind: Kind, id: string, user: { id: string; role: Role }): Promise<Found | null> {
  const journal = (sourceType: "INVOICE" | "EXPENSE") => tx.journalEntry.count({ where: { sourceType, sourceId: id } });
  switch (kind) {
    case "customer": {
      const r = await tx.customer.findUnique({ where: { id }, include: { _count: { select: { projects: true, invoices: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: r.name, row, counts: _count };
    }
    case "supplier": {
      const r = await tx.supplier.findUnique({ where: { id }, include: { _count: { select: { expenses: true, rentals: true, purchaseOrders: true, subcontracts: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: r.name, row, counts: _count };
    }
    case "project": {
      const r = await tx.project.findUnique({ where: { id }, include: { _count: { select: {
        expenses: true, invoices: true, lines: true, attendance: true, payAllocations: true, assetAssignments: true, assetUsages: true, rentals: true,
        purchaseOrders: true, stockMovements: true, subcontracts: true, tasks: true, siteReports: true, siteIssues: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: `${r.code} ${r.name}`, row, counts: _count, cleanup: () => tx.budgetLine.deleteMany({ where: { projectId: id } }) };
    }
    case "invoice": {
      const r = await tx.invoice.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      const problem = r.status !== "DRAFT" ? `${r.number} has been issued, so it stays on record. Void it instead.` : undefined;
      return { label: r.number, row, counts: { payments: _count.payments, journal: await journal("INVOICE") }, problem };
    }
    case "expense": {
      const r = await tx.expense.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      let problem: string | undefined;
      if (r.category === "STOCK_PURCHASE") problem = `${r.number} is a bill for stock received into the store. Reverse the goods receipt instead.`;
      else if (r.status !== "DRAFT" && r.status !== "SUBMITTED") problem = `${r.number} has been approved and posted to the books, so it stays on record. Void it instead.`;
      else if (r.createdById !== user.id && !APPROVERS.includes(user.role)) problem = `Only the person who entered ${r.number}, or finance staff, can delete it.`;
      return { label: r.number, row, counts: { payments: _count.payments, journal: await journal("EXPENSE") }, problem };
    }
    case "employee": {
      const r = await tx.employee.findUnique({ where: { id }, include: { _count: { select: { attendance: true, lines: true, advances: true, tasks: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: `${r.code} ${r.name}`, row, counts: { attendance: _count.attendance, payrollLines: _count.lines, advances: _count.advances, tasks: _count.tasks } };
    }
    case "material": {
      const r = await tx.material.findUnique({ where: { id }, include: { _count: { select: { movements: true, poLines: true, receipts: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: `${r.code} ${r.name}`, row, counts: _count };
    }
    case "asset": {
      const r = await tx.asset.findUnique({ where: { id }, include: { _count: { select: { assignments: true, usage: true, rentals: true, maintenance: true, expenses: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: `${r.code} ${r.name}`, row, counts: _count };
    }
    case "task": {
      const r = await tx.task.findUnique({ where: { id }, include: { _count: { select: { updates: true, issues: true, expenses: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      return { label: `${r.number} ${r.title}`, row, counts: _count };
    }
    case "subcontract": {
      const r = await tx.subcontract.findUnique({ where: { id }, include: { _count: { select: { variations: true, certificates: true, releases: true } } } });
      if (!r) return null;
      const { _count, ...row } = r;
      const problem = r.status !== "DRAFT" ? `${r.number} has started, so it stays on record. Cancel it instead.` : undefined;
      return { label: r.number, row, counts: _count, problem, cleanup: () => tx.subScheduleItem.deleteMany({ where: { subcontractId: id } }) };
    }
  }
}

const drop = (tx: Tx, kind: Kind, id: string) => {
  switch (kind) {
    case "customer": return tx.customer.delete({ where: { id } });
    case "supplier": return tx.supplier.delete({ where: { id } });
    case "project": return tx.project.delete({ where: { id } });
    case "invoice": return tx.invoice.delete({ where: { id } });
    case "expense": return tx.expense.delete({ where: { id } });
    case "employee": return tx.employee.delete({ where: { id } });
    case "material": return tx.material.delete({ where: { id } });
    case "asset": return tx.asset.delete({ where: { id } });
    case "task": return tx.task.delete({ where: { id } });
    case "subcontract": return tx.subcontract.delete({ where: { id } });
  }
};

export async function deleteRecord(_: FormState, fd: FormData): Promise<FormState> {
  // After deleting a record from its own page, the server sends the browser back to the list. Only paths inside the app are accepted.
  const goTo = String(fd.get("redirectTo") ?? "");
  const result = await deleteOnly(fd);
  if (result?.ok && /^\/[a-z0-9-]*$/.test(goTo)) redirect(goTo);
  return result;
}

async function deleteOnly(fd: FormData): Promise<FormState> {
  return run(async () => {
    const { kind, id, reason } = schema.parse(formObject(fd));
    if (!isKind(kind)) throw new ActionError("That kind of record cannot be deleted.");
    const def = KINDS[kind];
    const user = await requireWrite(def.module);
    // Project-level access: only things on projects you may see, and only people with access to every project delete shared records.
    if (!(await scopeOf(user)).all && ["customer", "supplier", "employee", "material", "asset"].includes(kind)) throw new ActionError("Only people with access to all projects can delete this.");
    if (kind === "project") await assertProject(user, id);
    else if (kind === "invoice") await assertInvoice(user, id);
    else if (kind === "expense") await assertExpense(user, id);
    else if (kind === "task") await assertRecord(user, "task", id);
    else if (kind === "subcontract") await assertRecord(user, "subcontract", id);

    return db.$transaction(async (tx) => {
      const found = await inspect(tx, kind, id, user);
      if (!found) throw new ActionError(`That ${def.noun} no longer exists.`);
      if (found.problem) throw new ActionError(found.problem);
      const blocked = dependents(found.counts);
      if (blocked) throw new ActionError(`${found.label} cannot be deleted: ${blocked}. Remove or void those first, or keep it.`);

      await found.cleanup?.();
      // Files attached to it are hidden, not erased, with the reason on record.
      await tx.attachment.updateMany({ where: { entity: def.model, entityId: id, removed: false }, data: { removed: true, removedAt: new Date(), removedById: user.id, removeReason: `${def.noun} deleted: ${reason}` } });
      await drop(tx, kind, id);
      await audit({ userId: user.id, action: `${kind}.delete`, entity: def.model, entityId: id, summary: `${user.name} deleted ${def.noun} ${found.label}: ${reason}`, before: found.row }, tx);
      return `${found.label} deleted`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}
