"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { D, fmt, sum } from "@/lib/money";
import { MANUAL_CATEGORIES } from "@/lib/domain";
import { date, formObject, optionalText, run, type FormState } from "@/lib/action";
import { ExpenseCategory, ProjectStatus } from "@/generated/prisma/enums";

const optionalDate = z.union([z.literal(""), date]).transform((v) => (v === "" ? null : v)).optional();

const projectSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(2, "Give the project a code, for example MCR-2026-01.").max(30),
  name: z.string().trim().min(3, "Give the project a name."),
  customerId: optionalText, location: optionalText, managerId: optionalText,
  contractValue: z.coerce.number({ error: "Enter the contract value." }).min(0, "Contract value cannot be negative."),
  status: z.enum(ProjectStatus),
  progress: z.coerce.number().int().min(0).max(100),
  startDate: optionalDate, expectedEnd: optionalDate, actualEnd: optionalDate,
});

export async function saveProject(_: FormState, fd: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await run(async () => {
    const user = await requireWrite("projects");
    const raw = formObject(fd);
    const v = projectSchema.parse(raw);
    if (v.startDate && v.expectedEnd && v.expectedEnd < v.startDate) throw new ActionError("The planned finish cannot be before the start date.");

    // Budget fields arrive as budget_<CATEGORY>. Blank or zero means no budget line.
    const budget: { category: ExpenseCategory; amount: number }[] = [];
    for (const c of MANUAL_CATEGORIES) {
      const n = Number(raw[`budget_${c}`] || 0);
      if (Number.isNaN(n) || n < 0) throw new ActionError("Budget amounts must be zero or more.");
      if (n > 0) budget.push({ category: c, amount: n });
    }
    const budgetTotal = sum(budget.map((b) => b.amount));
    if (budgetTotal.greaterThan(D(v.contractValue)) && v.contractValue > 0) {
      // Allowed (a loss-making job is still a real job) but it must be deliberate.
      if (raw.confirmLoss !== "on") throw new ActionError(`The budget (${fmt(budgetTotal)}) is above the contract value (${fmt(v.contractValue)}). Tick the box to confirm.`);
    }

    const data = {
      code: v.code, name: v.name, customerId: v.customerId ?? null, location: v.location ?? null, managerId: v.managerId ?? null,
      contractValue: D(v.contractValue), status: v.status, progress: v.progress,
      startDate: v.startDate ?? null, expectedEnd: v.expectedEnd ?? null, actualEnd: v.actualEnd ?? null,
    };

    return db.$transaction(async (tx) => {
      const clash = await tx.project.findFirst({ where: { code: v.code, id: v.id ? { not: v.id } : undefined } });
      if (clash) throw new ActionError(`Project code ${v.code} is already used by ${clash.name}.`);

      if (!v.id) {
        const p = await tx.project.create({ data: { ...data, budget: { create: budget.map((b) => ({ category: b.category, amount: D(b.amount) })) } } });
        await audit({ userId: user.id, action: "project.create", entity: "Project", entityId: p.id, summary: `${user.name} created project ${p.code} (${p.name}), contract ${fmt(p.contractValue)}`, after: data }, tx);
        goTo = `/projects/${p.id}`;
        return `${p.code} created`;
      }

      const before = await tx.project.findUniqueOrThrow({ where: { id: v.id }, include: { budget: true } });
      await tx.project.update({ where: { id: v.id }, data });
      await tx.budgetLine.deleteMany({ where: { projectId: v.id } });
      if (budget.length) await tx.budgetLine.createMany({ data: budget.map((b) => ({ projectId: v.id!, category: b.category, amount: D(b.amount) })) });

      if (!D(before.contractValue).equals(D(v.contractValue))) {
        await audit({ userId: user.id, action: "project.contract.update", entity: "Project", entityId: v.id, summary: `${user.name} changed ${v.code} contract value from ${fmt(before.contractValue)} to ${fmt(v.contractValue)}` }, tx);
      }
      const oldTotal = sum(before.budget.map((b) => b.amount));
      if (!oldTotal.equals(budgetTotal)) {
        await audit({ userId: user.id, action: "project.budget.update", entity: "Project", entityId: v.id, summary: `${user.name} changed ${v.code} budget from ${fmt(oldTotal)} to ${fmt(budgetTotal)}`, before: before.budget, after: budget }, tx);
      }
      if (before.status !== v.status) {
        await audit({ userId: user.id, action: "project.status", entity: "Project", entityId: v.id, summary: `${user.name} moved ${v.code} from ${before.status.toLowerCase()} to ${v.status.toLowerCase()}` }, tx);
      }
      return `${v.code} saved`;
    });
  });
  revalidatePath("/", "layout");
  if (goTo && result?.ok) redirect(goTo);
  return result;
}

const party = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter a name."),
  type: optionalText, contact: optionalText, phone: optionalText, email: z.union([z.literal(""), z.string().trim().email("That email address is not valid.")]).transform((v) => v || null).optional(),
  address: optionalText, paymentTerms: optionalText,
});

export async function saveCustomer(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("customers");
    const v = party.parse(formObject(fd));
    const data = { name: v.name, type: v.type ?? null, contact: v.contact ?? null, phone: v.phone ?? null, email: v.email ?? null, address: v.address ?? null };
    const clash = await db.customer.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, id: v.id ? { not: v.id } : undefined } });
    if (clash) throw new ActionError(`A customer called ${clash.name} already exists.`);
    const row = v.id ? await db.customer.update({ where: { id: v.id }, data }) : await db.customer.create({ data });
    await audit({ userId: user.id, action: v.id ? "customer.update" : "customer.create", entity: "Customer", entityId: row.id, summary: `${user.name} ${v.id ? "updated" : "added"} customer ${row.name}` });
    revalidatePath("/", "layout");
    return `${row.name} saved`;
  });
}

export async function saveSupplier(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("suppliers");
    const v = party.parse(formObject(fd));
    const data = { name: v.name, contact: v.contact ?? null, phone: v.phone ?? null, email: v.email ?? null, address: v.address ?? null, paymentTerms: v.paymentTerms ?? null };
    const clash = await db.supplier.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, id: v.id ? { not: v.id } : undefined } });
    if (clash) throw new ActionError(`A supplier called ${clash.name} already exists.`);
    const row = v.id ? await db.supplier.update({ where: { id: v.id }, data }) : await db.supplier.create({ data });
    await audit({ userId: user.id, action: v.id ? "supplier.update" : "supplier.create", entity: "Supplier", entityId: row.id, summary: `${user.name} ${v.id ? "updated" : "added"} supplier ${row.name}` });
    revalidatePath("/", "layout");
    return `${row.name} saved`;
  });
}
