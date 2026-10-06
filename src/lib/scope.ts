import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { allows, idsOf, makeScope, type Scope, type ScopeSetting } from "@/lib/scope-rules";

// Project-level access for the running app. Every page, action and download that touches project data goes through here,
// so hiding something in the browser is never the only protection: the server refuses what the person may not see.

type Who = { id: string; role: Role; projectScope: ScopeSetting };

// Looked up once per request. The key is made of plain values so React can cache it.
const load = cache(async (userId: string, role: Role, setting: ScopeSetting): Promise<Scope> => {
  if (makeScope(role, setting, []).all) return { all: true };
  const [assigned, managed] = await Promise.all([
    db.projectAccess.findMany({ where: { userId }, select: { projectId: true } }),
    db.project.findMany({ where: { managerId: userId }, select: { id: true } }),
  ]);
  return makeScope(role, setting, [...assigned.map((a) => a.projectId), ...managed.map((p) => p.id)]);
});

export const scopeOf = (u: Who) => load(u.id, u.role, u.projectScope);

/** For a Prisma `where` on Project itself. */
export const projectWhere = (scope: Scope): Prisma.ProjectWhereInput => (scope.all ? {} : { id: { in: scope.ids } });

/** For a Prisma `where` on anything with a `projectId` column. Records with no project are excluded for scoped people. */
export const onProject = (scope: Scope): { projectId?: { in: string[] } } => (scope.all ? {} : { projectId: { in: scope.ids } });

/**
 * Which expenses a person may see: those on their projects, plus company-level ones (no project) that they entered themselves.
 * Everyone with full access sees them all.
 */
export const expenseWhere = (scope: Scope, userId: string): Prisma.ExpenseWhereInput =>
  scope.all ? {} : { OR: [{ projectId: { in: scope.ids } }, { projectId: null, createdById: userId }] };

export const visibleIds = (scope: Scope) => idsOf(scope);

/** For server actions: stop with a message the form can show. */
export async function assertProject(u: Who, projectId: string | null | undefined) {
  if (!allows(await scopeOf(u), projectId)) throw new ActionError("You do not have access to that project.");
}

/** For pages and downloads: a project the person cannot see looks exactly like one that does not exist. */
export async function requireProject(u: Who, projectId: string) {
  if (!allows(await scopeOf(u), projectId)) notFound();
}

export const canSeeProject = async (u: Who, projectId: string | null | undefined) => allows(await scopeOf(u), projectId);

/** Can this person see this expense? Used before showing it, changing it, paying it or deleting it. */
const expenseVisible = async (u: Who & { id: string }, id: string) => (await db.expense.count({ where: { id, ...expenseWhere(await scopeOf(u), u.id) } })) > 0;
export async function assertExpense(u: Who, id: string) {
  if (!(await expenseVisible(u, id))) throw new ActionError("You do not have access to that expense.");
}
export async function requireExpense(u: Who, id: string) {
  if (!(await expenseVisible(u, id))) notFound();
}

// Invoices and payments belong to the project they were raised against.
const invoiceProject = async (id: string) => (await db.invoice.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
export async function assertInvoice(u: Who, id: string) {
  const pid = await invoiceProject(id);
  if (pid === undefined || !allows(await scopeOf(u), pid)) throw new ActionError("You do not have access to that invoice.");
}
export async function requireInvoice(u: Who, id: string) {
  const pid = await invoiceProject(id);
  if (pid === undefined || !allows(await scopeOf(u), pid)) notFound();
}
export async function assertPayment(u: Who, id: string) {
  const p = await db.payment.findUnique({ where: { id }, select: { invoice: { select: { projectId: true } }, expense: { select: { id: true } } } });
  if (!p) throw new ActionError("That payment does not exist.");
  if (p.invoice) return assertInvoice(u, (await db.payment.findUniqueOrThrow({ where: { id }, select: { invoiceId: true } })).invoiceId!);
  if (p.expense) return assertExpense(u, p.expense.id);
}

// Everything else that belongs to a project, found by its own id. A record with no project is company-level and is
// hidden from people who are limited to some projects.
export type Owned =
  | "task" | "siteReport" | "siteIssue" | "subcontract" | "subCertificate" | "subVariation" | "subScheduleItem" | "retentionRelease"
  | "purchaseOrder" | "goodsReceipt" | "stockMovement" | "assetUsage" | "assetAssignment" | "rental" | "attendance";

async function projectOfRecord(kind: Owned, id: string): Promise<string | null | undefined> {
  const sub = { select: { subcontract: { select: { projectId: true } } } } as const;
  switch (kind) {
    case "task": return (await db.task.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "siteReport": return (await db.siteReport.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "siteIssue": return (await db.siteIssue.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "subcontract": return (await db.subcontract.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "subCertificate": return (await db.subCertificate.findUnique({ where: { id }, ...sub }))?.subcontract.projectId;
    case "subVariation": return (await db.subVariation.findUnique({ where: { id }, ...sub }))?.subcontract.projectId;
    case "subScheduleItem": return (await db.subScheduleItem.findUnique({ where: { id }, ...sub }))?.subcontract.projectId;
    case "retentionRelease": return (await db.retentionRelease.findUnique({ where: { id }, ...sub }))?.subcontract.projectId;
    case "purchaseOrder": return (await db.purchaseOrder.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "goodsReceipt": return (await db.goodsReceipt.findUnique({ where: { id }, select: { order: { select: { projectId: true } } } }))?.order.projectId;
    case "stockMovement": return (await db.stockMovement.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "assetUsage": return (await db.assetUsage.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "assetAssignment": return (await db.assetAssignment.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "rental": return (await db.rental.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
    case "attendance": return (await db.attendance.findUnique({ where: { id }, select: { projectId: true } }))?.projectId;
  }
}

export async function assertRecord(u: Who, kind: Owned, id: string) {
  const pid = await projectOfRecord(kind, id);
  if (pid === undefined) throw new ActionError("That record does not exist.");
  if (!allows(await scopeOf(u), pid)) throw new ActionError("You do not have access to that project's records.");
}
export async function requireRecord(u: Who, kind: Owned, id: string) {
  const pid = await projectOfRecord(kind, id);
  if (pid === undefined || !allows(await scopeOf(u), pid)) notFound();
}

/** The signed-in person's scope, for pages made of several parts that do not each receive the user. */
export const currentScope = async () => scopeOf(await requireUser());

// Yes/no versions of the checks above, for downloads and other places that answer "not found" instead of throwing.
export async function canSeeInvoice(u: Who, id: string) {
  const pid = await invoiceProject(id);
  return pid !== undefined && allows(await scopeOf(u), pid);
}
export async function canSeeRecord(u: Who, kind: Owned, id: string) {
  const pid = await projectOfRecord(kind, id);
  return pid !== undefined && allows(await scopeOf(u), pid);
}
/** A record that files can be attached to: may this person see it? */
export async function canSeeEntity(u: Who, entity: string, id: string): Promise<boolean> {
  switch (entity) {
    case "Expense": return expenseVisible(u, id);
    case "Invoice": return canSeeInvoice(u, id);
    case "SiteReport": return canSeeRecord(u, "siteReport", id);
    case "PurchaseOrder": return canSeeRecord(u, "purchaseOrder", id);
    case "Subcontract": return canSeeRecord(u, "subcontract", id);
    default: return (await scopeOf(u)).all; // anything else is company-level
  }
}

/**
 * Company-wide books (the ledger, payroll, employee pay) are not split by project, so people limited to some projects
 * do not get them at all. Everyone else is unaffected.
 */
export async function requireCompanyWide(u: Who, what: string) {
  if (!(await scopeOf(u)).all) redirect(`/?denied=${encodeURIComponent(what)}`);
}
