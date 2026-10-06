"use server";

import { revalidatePath } from "next/cache";
import { assertInvoice, assertPayment, assertProject } from "@/lib/scope";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { postEntry, reverseEntries } from "@/lib/ledger";
import { SYS } from "@/lib/domain";
import { D, fmt2, sum } from "@/lib/money";
import { APPROVERS } from "@/lib/permissions";
import { date, formObject, money, optionalText, run, type FormState } from "@/lib/action";
import { PaymentMethod } from "@/generated/prisma/enums";

const invoiceSchema = z.object({
  id: z.string().optional(),
  number: z.string().trim().min(1).optional(),
  customerId: z.string().min(1, "Choose the customer."),
  projectId: z.string().min(1, "Choose the project this invoice is for."),
  issueDate: date, dueDate: date, amount: money, notes: optionalText,
});

export async function saveInvoice(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("invoices");
    const v = invoiceSchema.parse(formObject(fd));
    await assertProject(user, v.projectId);
    if (v.id) await assertInvoice(user, v.id);
    if (v.dueDate < v.issueDate) throw new ActionError("The due date cannot be before the issue date.");

    return db.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: v.projectId } });
      if (project.customerId && project.customerId !== v.customerId) throw new ActionError(`Project ${project.code} belongs to a different customer.`);
      if (project.status === "CANCELLED") throw new ActionError(`Project ${project.code} is cancelled.`);

      // Same customer, project, date and amount is almost certainly a double entry.
      const twin = await tx.invoice.findFirst({
        where: { customerId: v.customerId, projectId: v.projectId, issueDate: v.issueDate, amount: D(v.amount), status: { not: "VOID" }, id: v.id ? { not: v.id } : undefined },
      });
      if (twin) throw new ActionError(`Invoice ${twin.number} already has the same customer, project, date and amount.`);

      const base = { customerId: v.customerId, projectId: v.projectId, issueDate: v.issueDate, dueDate: v.dueDate, amount: D(v.amount), notes: v.notes ?? null };
      if (v.id) {
        const before = await tx.invoice.findUniqueOrThrow({ where: { id: v.id } });
        if (before.status !== "DRAFT") throw new ActionError(`${before.number} has been sent and cannot be edited. Void it and raise a new one.`);
        const after = await tx.invoice.update({ where: { id: v.id }, data: base });
        await audit({ userId: user.id, action: "invoice.update", entity: "Invoice", entityId: v.id, summary: `${user.name} edited ${after.number}`, before, after }, tx);
        return `${after.number} saved`;
      }
      const number = await nextNumber(tx, "INV");
      const inv = await tx.invoice.create({ data: { ...base, number } });
      await audit({ userId: user.id, action: "invoice.create", entity: "Invoice", entityId: inv.id, summary: `${user.name} created ${number} for ${fmt2(inv.amount)}`, after: inv }, tx);
      return `${number} created as a draft`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}

const stateSchema = z.object({ id: z.string(), to: z.enum(["SEND", "VOID"]), reason: optionalText });

export async function transitionInvoice(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("invoices");
    const { id, to, reason } = stateSchema.parse(formObject(fd));
    await assertInvoice(user, id);

    return db.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { payments: { where: { voided: false } } } });

      if (to === "SEND") {
        if (inv.status !== "DRAFT") throw new ActionError(`${inv.number} is already ${inv.status.toLowerCase()}.`);
        await tx.invoice.update({ where: { id }, data: { status: "SENT" } });
        // Revenue is recognised when the invoice goes out: the customer now owes it.
        await postEntry(tx, {
          date: inv.issueDate, description: `${inv.number} invoice`, reference: inv.number, sourceType: "INVOICE", sourceId: inv.id, createdById: user.id,
          lines: [
            { accountCode: SYS.AR, projectId: inv.projectId, debit: inv.amount },
            { accountCode: SYS.REVENUE, projectId: inv.projectId, credit: inv.amount },
          ],
        });
        await audit({ userId: user.id, action: "invoice.send", entity: "Invoice", entityId: id, summary: `${user.name} issued ${inv.number} for ${fmt2(inv.amount)}`, before: { status: inv.status }, after: { status: "SENT" } }, tx);
        return `${inv.number} issued`;
      }

      if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can void invoices.");
      if (inv.status === "VOID") throw new ActionError(`${inv.number} is already void.`);
      if (!reason) throw new ActionError("Give a reason for voiding this invoice.");
      if (inv.payments.length) throw new ActionError(`${inv.number} has payments recorded. Void those payments first.`);
      if (inv.status !== "DRAFT") await reverseEntries(tx, "INVOICE", inv.id, user.id, reason);
      await tx.invoice.update({ where: { id }, data: { status: "VOID", notes: `Voided: ${reason}` } });
      await audit({ userId: user.id, action: "invoice.void", entity: "Invoice", entityId: id, summary: `${user.name} voided ${inv.number}: ${reason}`, before: { status: inv.status }, after: { status: "VOID" } }, tx);
      return `${inv.number} voided`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}

const receiptSchema = z.object({
  invoiceId: z.string(), date, amount: money, accountId: z.string().min(1, "Choose where the money was received."),
  method: z.enum(PaymentMethod, { error: "Choose how it was paid." }), reference: optionalText,
});

export async function receivePayment(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("invoices");
    const v = receiptSchema.parse(formObject(fd));
    await assertInvoice(user, v.invoiceId);

    return db.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: v.invoiceId }, include: { payments: { where: { voided: false } } } });
      if (inv.status !== "SENT" && inv.status !== "PARTIAL") throw new ActionError(`${inv.number} is ${inv.status.toLowerCase()}. Payments can only be recorded on issued, unpaid invoices.`);
      const account = await tx.account.findUniqueOrThrow({ where: { id: v.accountId } });
      if (!account.isCash) throw new ActionError("Receive into a cash or bank account.");

      const outstanding = D(inv.amount).minus(sum(inv.payments.map((p) => p.amount)));
      const amount = D(v.amount);
      if (amount.greaterThan(outstanding)) throw new ActionError(`Only ${fmt2(outstanding)} is still owed on ${inv.number}.`);
      const dup = inv.payments.find((p) => D(p.amount).equals(amount) && p.date.getTime() === v.date.getTime() && (p.reference ?? "") === (v.reference ?? ""));
      if (dup) throw new ActionError(`A payment of ${fmt2(amount)} on that date and reference is already recorded (${dup.number}).`);

      const number = await nextNumber(tx, "REC");
      const pay = await tx.payment.create({
        data: { number, kind: "RECEIPT", date: v.date, amount, method: v.method, reference: v.reference ?? null, accountId: v.accountId, invoiceId: inv.id },
      });
      await postEntry(tx, {
        date: v.date, description: `${number} received for ${inv.number}`, reference: v.reference ?? inv.number, sourceType: "PAYMENT", sourceId: pay.id, createdById: user.id,
        lines: [
          { accountId: v.accountId, projectId: inv.projectId, debit: amount },
          { accountCode: SYS.AR, projectId: inv.projectId, credit: amount },
        ],
      });
      const settled = amount.equals(outstanding);
      await tx.invoice.update({ where: { id: inv.id }, data: { status: settled ? "PAID" : "PARTIAL" } });
      await audit({ userId: user.id, action: "invoice.receive", entity: "Invoice", entityId: inv.id, summary: `${user.name} recorded ${fmt2(amount)} received on ${inv.number} into ${account.name}`, after: { payment: number, settled } }, tx);
      return settled ? `${inv.number} paid in full` : `${fmt2(amount)} received, ${fmt2(outstanding.minus(amount))} still owed`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}

// A mistaken receipt is reversed, never deleted, and the invoice goes back to owing that amount.
export async function voidPayment(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("invoices");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can void payments.");
    const { id, reason } = z.object({ id: z.string(), reason: z.string().trim().min(3, "Give a reason for voiding this payment.") }).parse(formObject(fd));
    await assertPayment(user, id);

    return db.$transaction(async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id }, include: { invoice: { include: { payments: { where: { voided: false } } } }, expense: true } });
      if (p.voided) throw new ActionError(`${p.number} is already void.`);
      await reverseEntries(tx, "PAYMENT", p.id, user.id, reason);
      await tx.payment.update({ where: { id }, data: { voided: true } });
      if (p.invoice) {
        const left = p.invoice.payments.filter((x) => x.id !== p.id);
        await tx.invoice.update({ where: { id: p.invoice.id }, data: { status: left.length ? "PARTIAL" : "SENT" } });
      }
      if (p.expense) await tx.expense.update({ where: { id: p.expense.id }, data: { status: "APPROVED", paidAt: null } });
      await audit({ userId: user.id, action: "payment.void", entity: "Payment", entityId: id, summary: `${user.name} voided ${p.number} (${fmt2(p.amount)}): ${reason}` }, tx);
      return `${p.number} voided`;
    }).finally(() => revalidatePath("/", "layout"));
  });
}
