"use server";

import { revalidatePath } from "next/cache";
import { assertProject, assertRecord } from "@/lib/scope";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { postEntry, reverseEntries } from "@/lib/ledger";
import { SYS } from "@/lib/domain";
import { D, ZERO, fmt2, fmtDate } from "@/lib/money";
import { APPROVERS } from "@/lib/permissions";
import { SubcontractError, certify, checkRevision, retentionHeld, revisedValue } from "@/lib/subcontract";
import { date, formObject, money, optionalDate, optionalText, run, type FormState } from "@/lib/action";
import { PaymentMethod } from "@/generated/prisma/enums";

const refresh = () => revalidatePath("/", "layout");
const endOfToday = () => { const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d; };

// The rule functions throw their own error type. Show those messages to the person like any other validation problem.
function rules<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof SubcontractError) throw new ActionError(e.message); throw e; }
}

// Two people changing one subcontract at once must not both read the old balance.
async function lock(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Subcontract" WHERE id = ${id} FOR UPDATE`;
}

async function position(tx: Tx, id: string) {
  const sub = await tx.subcontract.findUniqueOrThrow({ where: { id }, include: { supplier: true, project: true, variations: true, certificates: { orderBy: { seq: "asc" } }, releases: { where: { voided: false } } } });
  const live = sub.certificates.filter((c) => c.status !== "VOID");
  const posted = live.filter((c) => c.status === "APPROVED" || c.status === "PAID");
  return {
    sub, live, posted,
    revised: revisedValue(sub.contractValue, sub.variations.filter((v) => v.approved).map((v) => v.amount)),
    certified: posted.length ? D(posted[posted.length - 1].workToDate) : ZERO,
    held: retentionHeld(posted.map((c) => c.retention), sub.releases.map((r) => r.amount)),
  };
}

async function openProject(tx: Tx, projectId: string) {
  const p = await tx.project.findUnique({ where: { id: projectId } });
  if (!p) throw new ActionError("That project does not exist.");
  if (p.status === "CANCELLED" || p.status === "COMPLETED") throw new ActionError(`Project ${p.code} is ${p.status.toLowerCase()}.`);
  return p;
}

/* ----------------------------------------- contracts ---------------------------------------- */

const subSchema = z.object({
  id: z.string().optional(),
  supplierId: z.string().min(1, "Choose the subcontractor."), projectId: z.string().min(1, "Choose the project."),
  scope: z.string().trim().min(5, "Describe the scope of work."),
  contractValue: money,
  retentionPct: z.coerce.number({ error: "Enter the retention percentage." }).min(0, "Retention cannot be negative.").max(20, "Retention above 20% is unusual. Check the figure."),
  startDate: optionalDate, endDate: optionalDate, notes: optionalText,
});

export async function saveSubcontract(_: FormState, fd: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await run(async () => {
    const user = await requireWrite("subcontracts");
    const v = subSchema.parse(formObject(fd));
    await assertProject(user, v.projectId); if (v.id) await assertRecord(user, "subcontract", v.id);
    if (v.startDate && v.endDate && v.endDate < v.startDate) throw new ActionError("The end date cannot be before the start date.");
    return db.$transaction(async (tx) => {
      await openProject(tx, v.projectId);
      const sup = await tx.supplier.findUniqueOrThrow({ where: { id: v.supplierId } });
      const data = { supplierId: v.supplierId, projectId: v.projectId, scope: v.scope, contractValue: D(v.contractValue), retentionPct: D(v.retentionPct), startDate: v.startDate ?? null, endDate: v.endDate ?? null, notes: v.notes ?? null };
      if (v.id) {
        const before = await tx.subcontract.findUniqueOrThrow({ where: { id: v.id } });
        if (before.status !== "DRAFT") throw new ActionError(`${before.number} is ${before.status.toLowerCase()}. Change its value with a variation instead.`);
        await tx.subcontract.update({ where: { id: v.id }, data });
        await audit({ userId: user.id, action: "subcontract.update", entity: "Subcontract", entityId: v.id, summary: `${user.name} edited ${before.number}` }, tx);
        goTo = v.id;
        refresh();
        return `${before.number} saved`;
      }
      const number = await nextNumber(tx, "SUB");
      const s = await tx.subcontract.create({ data: { ...data, number, createdById: user.id } });
      await audit({ userId: user.id, action: "subcontract.create", entity: "Subcontract", entityId: s.id, summary: `${user.name} drafted ${number} with ${sup.name}, ${fmt2(v.contractValue)}, ${v.retentionPct}% retention` }, tx);
      goTo = s.id;
      refresh();
      return `${number} drafted`;
    });
  });
  return goTo && result?.ok ? { ok: `${result.ok}|${goTo}` } : result;
}

export async function transitionSubcontract(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    const { id, to, reason } = z.object({ id: z.string(), to: z.enum(["ACTIVATE", "COMPLETE", "CANCEL"]), reason: optionalText }).parse(formObject(fd));
    await assertRecord(user, "subcontract", id);
    return db.$transaction(async (tx) => {
      await lock(tx, id);
      const p = await position(tx, id);
      const s = p.sub;
      if (to === "ACTIVATE") {
        if (s.status !== "DRAFT") throw new ActionError(`${s.number} is already ${s.status.toLowerCase()}.`);
        if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can sign a subcontract off.");
        if (s.createdById === user.id && user.role !== "SUPER_ADMIN") throw new ActionError("You drafted this subcontract, so someone else has to sign it off.");
        await openProject(tx, s.projectId);
        await tx.subcontract.update({ where: { id }, data: { status: "ACTIVE" } });
        await audit({ userId: user.id, action: "subcontract.activate", entity: "Subcontract", entityId: id, summary: `${user.name} signed off ${s.number} with ${s.supplier.name} for ${fmt2(s.contractValue)}` }, tx);
        refresh();
        return `${s.number} is now active`;
      }
      if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can complete or cancel a subcontract.");
      if (to === "COMPLETE") {
        if (s.status !== "ACTIVE") throw new ActionError(`${s.number} is ${s.status.toLowerCase()}, not active.`);
        if (p.live.some((c) => c.status === "DRAFT")) throw new ActionError("Approve or void the draft payment certificate first.");
        await tx.subcontract.update({ where: { id }, data: { status: "COMPLETED" } });
        await audit({ userId: user.id, action: "subcontract.complete", entity: "Subcontract", entityId: id, summary: `${user.name} marked ${s.number} complete with ${fmt2(p.certified)} of ${fmt2(p.revised)} certified` }, tx);
        refresh();
        return `${s.number} marked complete. Retention of ${fmt2(p.held)} can now be released.`;
      }
      if (s.status !== "DRAFT" && s.status !== "ACTIVE") throw new ActionError(`${s.number} is ${s.status.toLowerCase()}.`);
      if (p.posted.length) throw new ActionError(`${s.number} has approved payment certificates. Void them first, latest first.`);
      if (!reason) throw new ActionError("Give a reason for cancelling this subcontract.");
      await tx.subCertificate.updateMany({ where: { subcontractId: id, status: "DRAFT" }, data: { status: "VOID" } });
      await tx.subcontract.update({ where: { id }, data: { status: "CANCELLED", notes: `Cancelled: ${reason}` } });
      await audit({ userId: user.id, action: "subcontract.cancel", entity: "Subcontract", entityId: id, summary: `${user.name} cancelled ${s.number}: ${reason}` }, tx);
      refresh();
      return `${s.number} cancelled`;
    });
  });
}

/* ------------------------------------ variations and programme ------------------------------------ */

export async function addVariation(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    const v = z.object({ subcontractId: z.string(), description: z.string().trim().min(3, "Describe the change."), amount: z.coerce.number({ error: "Enter the amount." }) }).parse(formObject(fd));
    await assertRecord(user, "subcontract", v.subcontractId);
    if (!v.amount) throw new ActionError("A variation cannot be zero. Use a minus sign for omitted work.");
    return db.$transaction(async (tx) => {
      const s = await tx.subcontract.findUniqueOrThrow({ where: { id: v.subcontractId } });
      if (s.status !== "ACTIVE") throw new ActionError(`${s.number} is ${s.status.toLowerCase()}. Variations apply to active subcontracts.`);
      await tx.subVariation.create({ data: { subcontractId: s.id, description: v.description, amount: D(v.amount), createdById: user.id } });
      await audit({ userId: user.id, action: "subcontract.variation", entity: "Subcontract", entityId: s.id, summary: `${user.name} proposed a variation of ${fmt2(v.amount)} on ${s.number}: ${v.description}` }, tx);
      refresh();
      return `Variation of ${fmt2(v.amount)} proposed. It counts once finance approves it.`;
    });
  });
}

export async function decideVariation(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can decide a variation.");
    const { id, to } = z.object({ id: z.string(), to: z.enum(["APPROVE", "REJECT"]) }).parse(formObject(fd));
    await assertRecord(user, "subVariation", id);
    return db.$transaction(async (tx) => {
      const vr = await tx.subVariation.findUniqueOrThrow({ where: { id } });
      await lock(tx, vr.subcontractId);
      const p = await position(tx, vr.subcontractId);
      if (vr.approved) throw new ActionError("That variation is already approved.");
      if (to === "REJECT") {
        await tx.subVariation.delete({ where: { id } });
        await audit({ userId: user.id, action: "subcontract.variation.reject", entity: "Subcontract", entityId: vr.subcontractId, summary: `${user.name} rejected a variation of ${fmt2(vr.amount)} on ${p.sub.number}: ${vr.description}` }, tx);
        refresh();
        return "Variation rejected";
      }
      if (vr.createdById === user.id && user.role !== "SUPER_ADMIN") throw new ActionError("You proposed this variation, so someone else has to approve it.");
      const after = p.revised.plus(vr.amount);
      rules(() => checkRevision(after, p.certified));
      await tx.subVariation.update({ where: { id }, data: { approved: true, approvedById: user.id } });
      await audit({ userId: user.id, action: "subcontract.variation.approve", entity: "Subcontract", entityId: vr.subcontractId, summary: `${user.name} approved a variation of ${fmt2(vr.amount)} on ${p.sub.number}, changing its value from ${fmt2(p.revised)} to ${fmt2(after)}` }, tx);
      refresh();
      return `Approved. ${p.sub.number} is now ${fmt2(after)}.`;
    });
  });
}

export async function addScheduleItem(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    const v = z.object({ subcontractId: z.string(), description: z.string().trim().min(3, "Describe the milestone."), amount: money, dueDate: date }).parse(formObject(fd));
    await assertRecord(user, "subcontract", v.subcontractId);
    return db.$transaction(async (tx) => {
      await lock(tx, v.subcontractId);
      const p = await position(tx, v.subcontractId);
      if (p.sub.status === "CANCELLED" || p.sub.status === "COMPLETED") throw new ActionError(`${p.sub.number} is ${p.sub.status.toLowerCase()}.`);
      const planned = (await tx.subScheduleItem.findMany({ where: { subcontractId: v.subcontractId } })).reduce((a, i) => a.plus(i.amount), ZERO);
      if (planned.plus(v.amount).greaterThan(p.revised)) throw new ActionError(`The programme would add up to ${fmt2(planned.plus(v.amount))}, more than the contract value of ${fmt2(p.revised)}.`);
      await tx.subScheduleItem.create({ data: { subcontractId: v.subcontractId, description: v.description, amount: D(v.amount), dueDate: v.dueDate } });
      await audit({ userId: user.id, action: "subcontract.schedule", entity: "Subcontract", entityId: v.subcontractId, summary: `${user.name} added a milestone to ${p.sub.number}: ${v.description}, ${fmt2(v.amount)} by ${fmtDate(v.dueDate)}` }, tx);
      refresh();
      return "Milestone added";
    });
  });
}

export async function removeScheduleItem(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    const { id } = z.object({ id: z.string() }).parse(formObject(fd));
    await assertRecord(user, "subScheduleItem", id);
    const it = await db.subScheduleItem.findUniqueOrThrow({ where: { id }, include: { subcontract: true } });
    await db.subScheduleItem.delete({ where: { id } });
    await audit({ userId: user.id, action: "subcontract.schedule.remove", entity: "Subcontract", entityId: it.subcontractId, summary: `${user.name} removed a milestone from ${it.subcontract.number}: ${it.description}` });
    refresh();
    return "Milestone removed";
  });
}

/* ------------------------------------------ certificates ----------------------------------------- */

const certSchema = z.object({ subcontractId: z.string(), date, workToDate: money, notes: optionalText });

export async function createCertificate(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    const v = certSchema.parse(formObject(fd));
    await assertRecord(user, "subcontract", v.subcontractId);
    if (v.date > endOfToday()) throw new ActionError("The certificate date cannot be in the future.");
    return db.$transaction(async (tx) => {
      await lock(tx, v.subcontractId);
      const p = await position(tx, v.subcontractId);
      if (p.sub.status !== "ACTIVE") throw new ActionError(`${p.sub.number} is ${p.sub.status.toLowerCase()}. Certificates are raised on active subcontracts.`);
      if (p.live.some((c) => c.status === "DRAFT")) throw new ActionError("There is already a draft certificate. Approve or void it first.");
      const c = rules(() => certify({ revisedValue: p.revised, retentionPct: p.sub.retentionPct, previousToDate: p.certified, workToDate: v.workToDate }));
      const seq = (p.sub.certificates.reduce((m, x) => Math.max(m, x.seq), 0)) + 1;
      const number = await nextNumber(tx, "CRT");
      await tx.subCertificate.create({ data: { number, subcontractId: p.sub.id, seq, date: v.date, workToDate: D(v.workToDate), gross: c.gross, retention: c.retention, net: c.net, notes: v.notes ?? null, createdById: user.id } });
      await audit({ userId: user.id, action: "certificate.create", entity: "Subcontract", entityId: p.sub.id, summary: `${user.name} prepared ${number} (no. ${seq}) on ${p.sub.number}: work to date ${fmt2(v.workToDate)}, this certificate ${fmt2(c.gross)}, retention ${fmt2(c.retention)}, net ${fmt2(c.net)}` }, tx);
      refresh();
      return `${number}: ${fmt2(c.gross)} of work, ${fmt2(c.retention)} retention, ${fmt2(c.net)} payable once approved. ${c.percentComplete.toFixed(0)}% complete.`;
    });
  });
}

export async function transitionCertificate(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can approve or void payment certificates.");
    const { id, to, reason } = z.object({ id: z.string(), to: z.enum(["APPROVE", "VOID"]), reason: optionalText }).parse(formObject(fd));
    await assertRecord(user, "subCertificate", id);
    return db.$transaction(async (tx) => {
      const cert = await tx.subCertificate.findUniqueOrThrow({ where: { id } });
      await lock(tx, cert.subcontractId);
      const p = await position(tx, cert.subcontractId);
      const c = p.sub.certificates.find((x) => x.id === id)!;

      if (to === "APPROVE") {
        if (c.status !== "DRAFT") throw new ActionError(`${c.number} is already ${c.status.toLowerCase()}.`);
        if (c.createdById === user.id && user.role !== "SUPER_ADMIN") throw new ActionError("You prepared this certificate, so someone else has to approve it.");
        if (p.sub.status !== "ACTIVE") throw new ActionError(`${p.sub.number} is ${p.sub.status.toLowerCase()}.`);
        await openProject(tx, p.sub.projectId);
        // Re-work the figures now: a variation or a void may have changed what this certificate can claim.
        const f = rules(() => certify({ revisedValue: p.revised, retentionPct: p.sub.retentionPct, previousToDate: p.certified, workToDate: c.workToDate }));
        if (!f.gross.equals(c.gross)) throw new ActionError(`The position has changed since this was prepared (work already certified is now ${fmt2(p.certified)}). Void it and prepare a new one.`);
        // Full value is the project's cost. Only the net is owed now; the retention is owed later.
        await postEntry(tx, {
          date: c.date, description: `${c.number} ${p.sub.number} ${p.sub.supplier.name}`, reference: c.number, sourceType: "SUBCONTRACT", sourceId: c.id, createdById: user.id,
          lines: [
            { accountCode: SYS.SUBCONTRACT_EXPENSE, projectId: p.sub.projectId, debit: c.gross, memo: p.sub.scope.slice(0, 60) },
            ...(c.net.greaterThan(0) ? [{ accountCode: SYS.AP, projectId: p.sub.projectId, credit: c.net, memo: p.sub.supplier.name }] : []),
            ...(c.retention.greaterThan(0) ? [{ accountCode: SYS.RETENTION, projectId: p.sub.projectId, credit: c.retention, memo: `Retention, ${p.sub.supplier.name}` }] : []),
          ],
        });
        await tx.subCertificate.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
        await audit({ userId: user.id, action: "certificate.approve", entity: "Subcontract", entityId: p.sub.id, summary: `${user.name} approved ${c.number} on ${p.sub.number}: cost ${fmt2(c.gross)}, retention ${fmt2(c.retention)}, payable ${fmt2(c.net)}` }, tx);
        refresh();
        return `${c.number} approved and posted. ${fmt2(c.net)} is payable to ${p.sub.supplier.name}.`;
      }

      if (c.status === "VOID") throw new ActionError(`${c.number} is already void.`);
      if (!reason) throw new ActionError("Give a reason for voiding this certificate.");
      const latest = p.live[p.live.length - 1];
      if (latest.id !== c.id) throw new ActionError(`${latest.number} comes after this one. Void the latest certificate first, so the running total stays correct.`);
      if (c.status !== "DRAFT") {
        const heldWithout = retentionHeld(p.posted.filter((x) => x.id !== c.id).map((x) => x.retention), p.sub.releases.map((r) => r.amount));
        if (heldWithout.isNegative()) throw new ActionError("Retention has been released against this certificate. Void the release first.");
        await reverseEntries(tx, "SUBCONTRACT", c.id, user.id, reason);
      }
      await tx.subCertificate.update({ where: { id }, data: { status: "VOID", notes: `Voided: ${reason}` } });
      await audit({ userId: user.id, action: "certificate.void", entity: "Subcontract", entityId: p.sub.id, summary: `${user.name} voided ${c.number} on ${p.sub.number}: ${reason}` }, tx);
      refresh();
      return `${c.number} voided`;
    });
  });
}

const paySchema = z.object({ id: z.string(), date, accountId: z.string().min(1, "Choose the cash or bank account."), method: z.enum(PaymentMethod, { error: "Choose how it was paid." }), reference: optionalText });

export async function payCertificate(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can record payments.");
    const v = paySchema.parse(formObject(fd));
    await assertRecord(user, "subCertificate", v.id);
    if (v.date > endOfToday()) throw new ActionError("The payment date cannot be in the future.");
    return db.$transaction(async (tx) => {
      const cert = await tx.subCertificate.findUniqueOrThrow({ where: { id: v.id }, include: { subcontract: { include: { supplier: true } } } });
      await lock(tx, cert.subcontractId);
      const fresh = await tx.subCertificate.findUniqueOrThrow({ where: { id: v.id } });
      if (fresh.status !== "APPROVED") throw new ActionError(`${fresh.number} is ${fresh.status.toLowerCase()}. Only approved certificates can be paid.`);
      const acc = await tx.account.findUniqueOrThrow({ where: { id: v.accountId } });
      if (!acc.isCash) throw new ActionError("Pay from a cash or bank account.");
      if (fresh.net.greaterThan(0)) {
        await postEntry(tx, { date: v.date, description: `${fresh.number} paid to ${cert.subcontract.supplier.name}`, reference: v.reference ?? fresh.number, sourceType: "SUBCONTRACT", sourceId: fresh.id, createdById: user.id,
          lines: [{ accountCode: SYS.AP, projectId: cert.subcontract.projectId, debit: fresh.net }, { accountId: acc.id, projectId: cert.subcontract.projectId, credit: fresh.net }] });
      }
      await tx.subCertificate.update({ where: { id: v.id }, data: { status: "PAID", paidAt: v.date, payAccountId: acc.id, payMethod: v.method, payReference: v.reference ?? null } });
      await audit({ userId: user.id, action: "certificate.pay", entity: "Subcontract", entityId: cert.subcontractId, summary: `${user.name} paid ${fmt2(fresh.net)} on ${fresh.number} (${cert.subcontract.number}) from ${acc.name}` }, tx);
      refresh();
      return `${fmt2(fresh.net)} paid on ${fresh.number}`;
    });
  });
}

/* ------------------------------------------- retention ------------------------------------------- */

const releaseSchema = z.object({ subcontractId: z.string(), amount: money, date, accountId: z.string().min(1, "Choose the cash or bank account."), method: z.enum(PaymentMethod, { error: "Choose how it was paid." }), reference: optionalText });

export async function releaseRetention(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can release retention.");
    const v = releaseSchema.parse(formObject(fd));
    await assertRecord(user, "subcontract", v.subcontractId);
    if (v.date > endOfToday()) throw new ActionError("The date cannot be in the future.");
    return db.$transaction(async (tx) => {
      await lock(tx, v.subcontractId);
      const p = await position(tx, v.subcontractId);
      if (p.sub.status !== "COMPLETED") throw new ActionError(`${p.sub.number} is ${p.sub.status.toLowerCase()}. Retention is released once the subcontract is complete.`);
      if (D(v.amount).greaterThan(p.held)) throw new ActionError(`Only ${fmt2(p.held)} of retention is held on ${p.sub.number}.`);
      const acc = await tx.account.findUniqueOrThrow({ where: { id: v.accountId } });
      if (!acc.isCash) throw new ActionError("Pay from a cash or bank account.");
      const number = await nextNumber(tx, "RET");
      const rel = await tx.retentionRelease.create({ data: { number, subcontractId: p.sub.id, date: v.date, amount: D(v.amount), accountId: acc.id, method: v.method, reference: v.reference ?? null, createdById: user.id } });
      await postEntry(tx, { date: v.date, description: `${number} retention released to ${p.sub.supplier.name} (${p.sub.number})`, reference: v.reference ?? number, sourceType: "SUBCONTRACT", sourceId: rel.id, createdById: user.id,
        lines: [{ accountCode: SYS.RETENTION, projectId: p.sub.projectId, debit: v.amount }, { accountId: acc.id, projectId: p.sub.projectId, credit: v.amount }] });
      await audit({ userId: user.id, action: "retention.release", entity: "Subcontract", entityId: p.sub.id, summary: `${user.name} released ${fmt2(v.amount)} retention to ${p.sub.supplier.name} on ${p.sub.number} (${number})` }, tx);
      refresh();
      return `${number}: ${fmt2(v.amount)} released. ${fmt2(p.held.minus(v.amount))} still held.`;
    });
  });
}

export async function voidRelease(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("subcontracts");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can void a retention release.");
    const { id, reason } = z.object({ id: z.string(), reason: z.string().trim().min(3, "Give a reason for voiding this release.") }).parse(formObject(fd));
    await assertRecord(user, "retentionRelease", id);
    return db.$transaction(async (tx) => {
      const r = await tx.retentionRelease.findUniqueOrThrow({ where: { id }, include: { subcontract: true } });
      await lock(tx, r.subcontractId);
      if (r.voided) throw new ActionError(`${r.number} is already void.`);
      await reverseEntries(tx, "SUBCONTRACT", r.id, user.id, reason);
      await tx.retentionRelease.update({ where: { id }, data: { voided: true } });
      await audit({ userId: user.id, action: "retention.void", entity: "Subcontract", entityId: r.subcontractId, summary: `${user.name} voided ${r.number} (${fmt2(r.amount)}) on ${r.subcontract.number}: ${reason}` }, tx);
      refresh();
      return `${r.number} voided`;
    });
  });
}
