import type { Tx } from "@/lib/db";
import { D, ZERO, type Money, type Amount } from "@/lib/money";
import { nextNumber } from "@/lib/sequence";
import { ActionError } from "@/lib/errors";


export type Line = { accountCode?: string; accountId?: string; projectId?: string | null; debit?: Amount; credit?: Amount; memo?: string };

type Post = {
  date: Date; description: string; reference?: string | null;
  sourceType: "EXPENSE" | "INVOICE" | "PAYMENT" | "PAYROLL" | "ADVANCE" | "STOCK" | "SUBCONTRACT" | "MANUAL" | "REVERSAL"; sourceId?: string | null;
  createdById: string; lines: Line[];
};

async function resolveAccountId(tx: Tx, l: Line): Promise<string> {
  if (l.accountId) return l.accountId;
  const a = await tx.account.findUnique({ where: { code: l.accountCode! } });
  if (!a) throw new ActionError(`Ledger account ${l.accountCode} does not exist.`);
  return a.id;
}

// The only function that writes journal entries. Refuses anything that does not balance.
export async function postEntry(tx: Tx, p: Post) {
  const debit = p.lines.reduce<Money>((a, l) => a.plus(D(l.debit)), ZERO);
  const credit = p.lines.reduce<Money>((a, l) => a.plus(D(l.credit)), ZERO);
  if (p.lines.length < 2) throw new ActionError("A journal entry needs at least two lines.");
  if (!debit.equals(credit)) throw new ActionError(`Entry does not balance: debit ${debit} vs credit ${credit}.`);
  if (debit.isZero()) throw new ActionError("A journal entry cannot be zero.");

  const number = await nextNumber(tx, "JE");
  const lines = [];
  for (const l of p.lines) {
    lines.push({
      accountId: await resolveAccountId(tx, l), projectId: l.projectId ?? null,
      debit: D(l.debit), credit: D(l.credit), memo: l.memo ?? null,
    });
  }
  return tx.journalEntry.create({
    data: {
      number, date: p.date, description: p.description, reference: p.reference ?? null,
      sourceType: p.sourceType, sourceId: p.sourceId ?? null, createdById: p.createdById,
      lines: { create: lines },
    },
  });
}

// Corrections never edit history: this posts the mirror image and marks the original REVERSED.
export async function reverseEntries(tx: Tx, sourceType: "EXPENSE" | "INVOICE" | "PAYMENT" | "PAYROLL" | "ADVANCE" | "STOCK" | "SUBCONTRACT", sourceId: string, userId: string, why: string) {
  const entries = await tx.journalEntry.findMany({
    where: { sourceType, sourceId, status: "POSTED", reversesId: null }, include: { lines: true },
  });
  for (const e of entries) {
    const rev = await postEntry(tx, {
      date: new Date(), description: `Reversal of ${e.number}: ${why}`, reference: e.number,
      sourceType: "REVERSAL", sourceId, createdById: userId,
      lines: e.lines.map((l) => ({ accountId: l.accountId, projectId: l.projectId, debit: l.credit, credit: l.debit, memo: l.memo ?? undefined })),
    });
    await tx.journalEntry.update({ where: { id: rev.id }, data: { reversesId: e.id } });
    await tx.journalEntry.update({ where: { id: e.id }, data: { status: "REVERSED" } });
  }
  return entries.length;
}
