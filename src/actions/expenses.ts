"use server";

import { revalidatePath } from "next/cache";
import { assertExpense, assertProject, scopeOf } from "@/lib/scope";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { postEntry, reverseEntries } from "@/lib/ledger";
import { CATEGORY_ACCOUNT, SYS } from "@/lib/domain";
import { D, fmt2, sum } from "@/lib/money";
import { APPROVERS } from "@/lib/permissions";
import { date, formObject, money, optionalText, run, type FormState } from "@/lib/action";
import { ExpenseCategory, PaymentMethod } from "@/generated/prisma/enums";

const expenseSchema = z.object({
  id: z.string().optional(),
  date,
  projectId: optionalText,
  category: z.enum(ExpenseCategory, { error: "Choose a category." }),
  supplierId: optionalText,
  assetId: optionalText,
  taskId: optionalText,
  payee: optionalText,
  description: z.string().trim().min(3, "Describe what the money was for."),
  amount: money,
  paymentMethod: optionalText,
  notes: optionalText,
});

async function assertProjectOpen(tx: Tx, projectId: string | null | undefined) {
  if (!projectId) return;
  const p = await tx.project.findUnique({ where: { id: projectId } });
  if (!p) throw new ActionError("That project does not exist.");
  if (p.status === "CANCELLED" || p.status === "COMPLETED") {
    throw new ActionError(`Project ${p.code} is ${p.status.toLowerCase()}. Costs cannot be booked to it.`);
  }
}

export async function saveExpense(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("expenses");
    const v = expenseSchema.parse(formObject(fd));
    // Project-level access: the server decides, whatever the browser sent.
    if (!(await scopeOf(user)).all && !v.projectId) throw new ActionError("Choose the project this cost belongs to.");
    if (v.projectId) await assertProject(user, v.projectId);
    if (v.id) await assertExpense(user, v.id);
    if (v.category === "STOCK_PURCHASE") throw new ActionError("Stock bills are raised by receiving goods against a purchase order.");
    if (v.paymentMethod && !(v.paymentMethod in PaymentMethod)) throw new ActionError("Choose a valid payment method.");

    return db.$transaction(async (tx) => {
      await assertProjectOpen(tx, v.projectId);
      if (v.taskId) {
        const t = await tx.task.findUnique({ where: { id: v.taskId } });
        if (!t) throw new ActionError("That task does not exist.");
        if (t.projectId !== v.projectId) throw new ActionError("A task cost must be booked to the same project as the task.");
      }
      const account = await tx.account.findUniqueOrThrow({ where: { code: CATEGORY_ACCOUNT[v.category] } });
      const data = {
        date: v.date, projectId: v.projectId ?? null, category: v.category, supplierId: v.supplierId ?? null, assetId: v.assetId ?? null, taskId: v.taskId ?? null,
        payee: v.payee ?? null, description: v.description, amount: D(v.amount),
        paymentMethod: (v.paymentMethod as PaymentMethod | null) ?? null, notes: v.notes ?? null, accountId: account.id,
      };
      if (v.id) {
        const before = await tx.expense.findUniqueOrThrow({ where: { id: v.id } });
        // Once submitted, an expense is part of the approval workflow and cannot be edited in place.
        if (before.status !== "DRAFT") throw new ActionError(`${before.number} is ${before.status.toLowerCase()} and can no longer be edited. Void it and enter a new one.`);
        const after = await tx.expense.update({ where: { id: v.id }, data });
        await audit({ userId: user.id, action: "expense.update", entity: "Expense", entityId: after.id, summary: `${user.name} edited ${after.number}`, before, after }, tx);
        return `${after.number} saved`;
      }
      const number = await nextNumber(tx, "EXP");
      const created = await tx.expense.create({ data: { ...data, number, createdById: user.id } });
      await audit({ userId: user.id, action: "expense.create", entity: "Expense", entityId: created.id, summary: `${user.name} created ${number} for ${fmt2(created.amount)}`, after: created }, tx);
      return `${number} created as a draft`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}

const transitionSchema = z.object({
  id: z.string(),
  to: z.enum(["SUBMIT", "APPROVE", "REJECT", "VOID"]),
  reason: optionalText,
});

// One entry point for every status change so the rules sit in a single place.
export async function transitionExpense(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("expenses");
    const { id, to, reason } = transitionSchema.parse(formObject(fd));
    await assertExpense(user, id);

    return db.$transaction(async (tx) => {
      const e = await tx.expense.findUniqueOrThrow({ where: { id }, include: { payments: { where: { voided: false } } } });
      const needsApprover = to !== "SUBMIT";
      if (needsApprover && !APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can approve, send back or void expenses.");

      if (to === "SUBMIT") {
        if (e.status !== "DRAFT") throw new ActionError(`${e.number} is already ${e.status.toLowerCase()}.`);
        await assertProjectOpen(tx, e.projectId);
        await tx.expense.update({ where: { id }, data: { status: "SUBMITTED" } });
        await audit({ userId: user.id, action: "expense.submit", entity: "Expense", entityId: id, summary: `${user.name} submitted ${e.number} for ${fmt2(e.amount)}`, before: { status: e.status }, after: { status: "SUBMITTED" } }, tx);
        return `${e.number} submitted for approval`;
      }

      if (to === "APPROVE") {
        if (e.status !== "SUBMITTED") throw new ActionError(`${e.number} is ${e.status.toLowerCase()}, so it cannot be approved.`);
        if (e.createdById === user.id && user.role !== "SUPER_ADMIN") throw new ActionError("You created this expense, so someone else has to approve it.");
        await assertProjectOpen(tx, e.projectId);
        await tx.expense.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
        // Cost is recognised on approval: it is owed even before it is paid.
        await postEntry(tx, {
          date: e.date, description: `${e.number} ${e.description}`, reference: e.number, sourceType: "EXPENSE", sourceId: e.id, createdById: user.id,
          lines: [
            { accountId: e.accountId, projectId: e.projectId, debit: e.amount, memo: e.description },
            { accountCode: SYS.AP, projectId: e.projectId, credit: e.amount, memo: e.payee ?? undefined },
          ],
        });
        await audit({ userId: user.id, action: "expense.approve", entity: "Expense", entityId: id, summary: `${user.name} approved ${e.number} for ${fmt2(e.amount)}`, before: { status: e.status }, after: { status: "APPROVED" } }, tx);
        return `${e.number} approved and posted to the ledger`;
      }

      if (to === "REJECT") {
        if (e.status !== "SUBMITTED") throw new ActionError(`${e.number} is ${e.status.toLowerCase()}, so it cannot be sent back.`);
        await tx.expense.update({ where: { id }, data: { status: "DRAFT", notes: reason ? `Sent back: ${reason}` : e.notes } });
        await audit({ userId: user.id, action: "expense.reject", entity: "Expense", entityId: id, summary: `${user.name} sent ${e.number} back to draft${reason ? `: ${reason}` : ""}` }, tx);
        return `${e.number} sent back to draft`;
      }

      // VOID: nothing is deleted. Payments and ledger entries are reversed and the expense stays on record.
      if (e.status === "VOID") throw new ActionError(`${e.number} is already void.`);
      if (e.category === "STOCK_PURCHASE") throw new ActionError(`${e.number} is a bill for stock received into the store. Reverse the goods receipt instead, so the stock and the bill stay in step.`);
      if (!reason) throw new ActionError("Give a reason for voiding this expense.");
      for (const p of e.payments) {
        await reverseEntries(tx, "PAYMENT", p.id, user.id, `void ${e.number}`);
        await tx.payment.update({ where: { id: p.id }, data: { voided: true } });
      }
      await reverseEntries(tx, "EXPENSE", e.id, user.id, reason);
      await tx.expense.update({ where: { id }, data: { status: "VOID", notes: `Voided: ${reason}` } });
      await audit({ userId: user.id, action: "expense.void", entity: "Expense", entityId: id, summary: `${user.name} voided ${e.number} (${fmt2(e.amount)}): ${reason}`, before: { status: e.status }, after: { status: "VOID" } }, tx);
      return `${e.number} voided`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}

const paySchema = z.object({
  expenseId: z.string(), date, amount: money, accountId: z.string().min(1, "Choose the cash or bank account."),
  method: z.enum(PaymentMethod, { error: "Choose how it was paid." }), reference: optionalText,
});

export async function payExpense(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("expenses");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can record payments.");
    const v = paySchema.parse(formObject(fd));
    await assertExpense(user, v.expenseId);

    return db.$transaction(async (tx) => {
      const e = await tx.expense.findUniqueOrThrow({ where: { id: v.expenseId }, include: { payments: { where: { voided: false } } } });
      if (e.status !== "APPROVED") throw new ActionError(`${e.number} is ${e.status.toLowerCase()}. Only approved expenses can be paid.`);
      const account = await tx.account.findUniqueOrThrow({ where: { id: v.accountId } });
      if (!account.isCash) throw new ActionError("Pay from a cash or bank account.");

      const outstanding = D(e.amount).minus(sum(e.payments.map((p) => p.amount)));
      const amount = D(v.amount);
      if (amount.greaterThan(outstanding)) throw new ActionError(`Only ${fmt2(outstanding)} is still owed on ${e.number}.`);
      const dup = e.payments.find((p) => D(p.amount).equals(amount) && p.date.getTime() === v.date.getTime() && (p.reference ?? "") === (v.reference ?? ""));
      if (dup) throw new ActionError(`A payment of ${fmt2(amount)} on that date and reference is already recorded (${dup.number}).`);

      const number = await nextNumber(tx, "PAY");
      const pay = await tx.payment.create({
        data: { number, kind: "DISBURSEMENT", date: v.date, amount, method: v.method, reference: v.reference ?? null, accountId: v.accountId, expenseId: e.id },
      });
      await postEntry(tx, {
        date: v.date, description: `${number} payment for ${e.number}`, reference: v.reference ?? e.number, sourceType: "PAYMENT", sourceId: pay.id, createdById: user.id,
        lines: [
          { accountCode: SYS.AP, projectId: e.projectId, debit: amount },
          { accountId: v.accountId, projectId: e.projectId, credit: amount },
        ],
      });
      const settled = amount.equals(outstanding);
      if (settled) await tx.expense.update({ where: { id: e.id }, data: { status: "PAID", paidAt: v.date } });
      await audit({ userId: user.id, action: "expense.pay", entity: "Expense", entityId: e.id, summary: `${user.name} paid ${fmt2(amount)} on ${e.number} from ${account.name}`, after: { payment: number, settled } }, tx);
      return settled ? `${e.number} paid in full` : `${fmt2(amount)} paid, ${fmt2(outstanding.minus(amount))} still owed`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}
