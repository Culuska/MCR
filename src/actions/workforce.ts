"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { postEntry, reverseEntries } from "@/lib/ledger";
import { SYS } from "@/lib/domain";
import { D, ZERO, fmt2, sum } from "@/lib/money";
import { APPROVERS } from "@/lib/permissions";
import { computePay } from "@/lib/payroll";
import { outstandingAdvance } from "@/lib/workforce";
import { date, formObject, money, optionalText, run, type FormState } from "@/lib/action";
import { AttendanceStatus, PayType, PaymentMethod } from "@/generated/prisma/enums";

const refresh = () => revalidatePath("/", "layout");
const dayMs = 86400000;
const periodDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / dayMs) + 1;

/* ---------------------------------- employees --------------------------------- */

const employeeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the employee's name."),
  position: z.string().trim().min(2, "Enter their position."),
  department: optionalText, phone: optionalText, paymentDetails: optionalText,
  payType: z.enum(PayType),
  rate: z.coerce.number({ error: "Enter the wage or salary." }).positive("The wage or salary must be more than zero.").max(1e6),
  overtimeRate: z.coerce.number().min(0, "Overtime rate cannot be negative.").max(1e5),
  active: z.enum(["on", "off"]).default("on"),
});

export async function saveEmployee(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("payroll");
    const v = employeeSchema.parse(formObject(fd));
    const data = {
      name: v.name, position: v.position, department: v.department ?? null, phone: v.phone ?? null, paymentDetails: v.paymentDetails ?? null,
      payType: v.payType, rate: D(v.rate), overtimeRate: D(v.overtimeRate), active: v.active === "on",
    };
    return db.$transaction(async (tx) => {
      if (v.id) {
        const before = await tx.employee.findUniqueOrThrow({ where: { id: v.id } });
        await tx.employee.update({ where: { id: v.id }, data });
        const rateChanged = !D(before.rate).equals(D(v.rate));
        await audit({ userId: user.id, action: "employee.update", entity: "Employee", entityId: v.id,
          summary: rateChanged ? `${user.name} changed ${before.name}'s ${v.payType === "DAILY" ? "daily wage" : "monthly salary"} from ${fmt2(before.rate)} to ${fmt2(v.rate)}` : `${user.name} updated ${before.name}` }, tx);
        refresh();
        return `${v.name} saved`;
      }
      const code = (await nextNumber(tx, "EMP")).replace("EMP-0", "EMP-");
      const e = await tx.employee.create({ data: { ...data, code } });
      await audit({ userId: user.id, action: "employee.create", entity: "Employee", entityId: e.id, summary: `${user.name} added ${e.name} (${e.code}), ${e.position}` }, tx);
      refresh();
      return `${e.name} added as ${e.code}`;
    });
  });
}

/* ---------------------------------- advances ---------------------------------- */

const advanceSchema = z.object({ employeeId: z.string(), date, amount: money, accountId: z.string().min(1, "Choose where the money was paid from."), note: optionalText });

export async function giveAdvance(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("payroll");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can pay out advances.");
    const v = advanceSchema.parse(formObject(fd));
    return db.$transaction(async (tx) => {
      const emp = await tx.employee.findUniqueOrThrow({ where: { id: v.employeeId } });
      const acc = await tx.account.findUniqueOrThrow({ where: { id: v.accountId } });
      if (!acc.isCash) throw new ActionError("Pay advances from a cash or bank account.");
      const number = await nextNumber(tx, "ADV");
      const adv = await tx.advance.create({ data: { number, employeeId: emp.id, date: v.date, amount: D(v.amount), accountId: acc.id, note: v.note ?? null, createdById: user.id } });
      await postEntry(tx, { date: v.date, description: `${number} advance to ${emp.name}`, reference: number, sourceType: "ADVANCE", sourceId: adv.id, createdById: user.id,
        lines: [{ accountCode: SYS.ADVANCES, debit: v.amount, memo: emp.name }, { accountId: acc.id, credit: v.amount }] });
      await audit({ userId: user.id, action: "advance.give", entity: "Employee", entityId: emp.id, summary: `${user.name} paid ${emp.name} an advance of ${fmt2(v.amount)} (${number})` }, tx);
      refresh();
      return `${number}: ${fmt2(v.amount)} advanced to ${emp.name}`;
    });
  });
}

/* --------------------------------- attendance --------------------------------- */

export async function saveAttendance(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("attendance");
    const raw = formObject(fd);
    const day = date.parse(raw.date);
    const today = new Date(); today.setUTCHours(23, 59, 59, 999);
    if (day > today) throw new ActionError("You cannot record attendance for a future date.");
    const projectId = raw.projectId ? String(raw.projectId) : null;

    return db.$transaction(async (tx) => {
      if (projectId) {
        const p = await tx.project.findUnique({ where: { id: projectId } });
        if (!p) throw new ActionError("That project does not exist.");
        if (p.status === "CANCELLED" || p.status === "COMPLETED") throw new ActionError(`Project ${p.code} is ${p.status.toLowerCase()}.`);
      }
      const employees = await tx.employee.findMany({ where: { active: true } });
      let saved = 0, cleared = 0;
      for (const e of employees) {
        const status = String(raw[`s_${e.id}`] ?? "");
        if (!status && raw[`had_${e.id}`] !== "1") continue;

        // Days already paid in an approved or paid run are closed.
        const locked = await tx.payrollLine.findFirst({ where: { employeeId: e.id, run: { status: { not: "VOID" }, periodStart: { lte: day }, periodEnd: { gte: day } } }, include: { run: true } });
        if (locked) throw new ActionError(`${e.name}'s attendance for that date is part of payroll run ${locked.run.number}. Void the run to change it.`);

        if (!status) { await tx.attendance.deleteMany({ where: { employeeId: e.id, date: day } }); cleared++; continue; }
        if (!(status in AttendanceStatus)) throw new ActionError(`Choose a valid status for ${e.name}.`);
        const ot = Number(raw[`ot_${e.id}`] || 0);
        if (Number.isNaN(ot) || ot < 0 || ot > 16) throw new ActionError(`Overtime for ${e.name} must be between 0 and 16 hours.`);
        if (ot > 0 && status !== "PRESENT" && status !== "HALF_DAY") throw new ActionError(`${e.name} has overtime but is not marked present.`);
        const data = { status: status as keyof typeof AttendanceStatus, overtimeHours: D(ot), projectId, recordedById: user.id };
        await tx.attendance.upsert({ where: { employeeId_date: { employeeId: e.id, date: day } }, create: { employeeId: e.id, date: day, ...data }, update: data });
        saved++;
      }
      await audit({ userId: user.id, action: "attendance.save", entity: "Attendance", entityId: day.toISOString().slice(0, 10), summary: `${user.name} recorded attendance for ${saved} people on ${day.toISOString().slice(0, 10)}${cleared ? `, cleared ${cleared}` : ""}` }, tx);
      refresh();
      return `Attendance saved for ${saved} ${saved === 1 ? "person" : "people"}`;
    });
  });
}

/* ------------------------------------ payroll --------------------------------- */

// Rebuilds one pay line from attendance and the given adjustments, replacing its project allocations.
async function rebuildLine(tx: Tx, runId: string, employeeId: string, start: Date, end: Date, adj: { bonus: number; deductions: number; advanceRecovered: number }) {
  const emp = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const days = await tx.attendance.findMany({ where: { employeeId, date: { gte: start, lte: end } } });
  const pay = computePay(emp, days, periodDays(start, end), adj);
  if (pay.net.isNegative()) throw new ActionError(`${emp.name}'s deductions and advance (${fmt2(pay.deductions.plus(pay.advanceRecovered))}) are more than their pay (${fmt2(pay.gross)}).`);
  const outstanding = await outstandingAdvance(tx, employeeId);
  if (pay.advanceRecovered.greaterThan(outstanding)) throw new ActionError(`${emp.name} only owes ${fmt2(outstanding)} in advances.`);

  const data = { paidDays: D(pay.paidDays), overtimeHours: pay.overtimeHours, basePay: pay.basePay, overtimePay: pay.overtimePay, bonus: pay.bonus, deductions: pay.deductions, advanceRecovered: pay.advanceRecovered, gross: pay.gross, net: pay.net };
  const line = await tx.payrollLine.upsert({ where: { runId_employeeId: { runId, employeeId } }, create: { runId, employeeId, ...data }, update: data });
  await tx.payrollAllocation.deleteMany({ where: { lineId: line.id } });
  if (pay.allocations.length) await tx.payrollAllocation.createMany({ data: pay.allocations.map((a) => ({ lineId: line.id, projectId: a.projectId, amount: a.amount })) });
  return line;
}

const runSchema = z.object({ periodStart: date, periodEnd: date, notes: optionalText });

export async function createPayrollRun(_: FormState, fd: FormData): Promise<FormState> {
  let newId: string | null = null;
  const result = await run(async () => {
    const user = await requireWrite("payroll");
    const v = runSchema.parse(formObject(fd));
    if (v.periodEnd < v.periodStart) throw new ActionError("The period end cannot be before the start.");
    if (periodDays(v.periodStart, v.periodEnd) > 92) throw new ActionError("A payroll period cannot be longer than three months.");
    const today = new Date(); today.setUTCHours(23, 59, 59, 999);
    if (v.periodEnd > today) throw new ActionError("The period cannot end in the future.");

    return db.$transaction(async (tx) => {
      const records = await tx.attendance.groupBy({ by: ["employeeId"], where: { date: { gte: v.periodStart, lte: v.periodEnd } } });
      if (!records.length) throw new ActionError("No attendance was recorded in that period, so there is nothing to pay.");

      // One employee cannot be paid twice for the same days.
      const clash = await tx.payrollLine.findFirst({
        where: { employeeId: { in: records.map((r) => r.employeeId) }, run: { status: { not: "VOID" }, periodStart: { lte: v.periodEnd }, periodEnd: { gte: v.periodStart } } },
        include: { employee: true, run: true },
      });
      if (clash) throw new ActionError(`${clash.employee.name} is already in payroll run ${clash.run.number}, which overlaps this period.`);

      const number = await nextNumber(tx, "PRN");
      const r = await tx.payrollRun.create({ data: { number, periodStart: v.periodStart, periodEnd: v.periodEnd, notes: v.notes ?? null, createdById: user.id } });
      let people = 0;
      for (const rec of records) {
        const line = await rebuildLine(tx, r.id, rec.employeeId, v.periodStart, v.periodEnd, { bonus: 0, deductions: 0, advanceRecovered: 0 });
        if (line.gross.isZero()) await tx.payrollLine.delete({ where: { id: line.id } }); else people++;
      }
      if (!people) throw new ActionError("Everyone in that period has zero paid days, so there is nothing to pay.");
      await audit({ userId: user.id, action: "payroll.create", entity: "PayrollRun", entityId: r.id, summary: `${user.name} prepared payroll ${number} for ${people} people` }, tx);
      newId = r.id;
      refresh();
      return `${number} prepared for ${people} people`;
    });
  });
  if (newId && result?.ok) return { ok: `${result.ok}|${newId}` };
  return result;
}

const lineSchema = z.object({
  lineId: z.string(),
  bonus: z.coerce.number().min(0, "Bonus cannot be negative.").max(1e6).default(0),
  deductions: z.coerce.number().min(0, "Deductions cannot be negative.").max(1e6).default(0),
  advanceRecovered: z.coerce.number().min(0, "The advance recovered cannot be negative.").max(1e6).default(0),
});

export async function updatePayrollLine(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("payroll");
    const v = lineSchema.parse(formObject(fd));
    return db.$transaction(async (tx) => {
      const line = await tx.payrollLine.findUniqueOrThrow({ where: { id: v.lineId }, include: { run: true, employee: true } });
      if (line.run.status !== "DRAFT") throw new ActionError(`${line.run.number} is ${line.run.status.toLowerCase()} and cannot be changed.`);
      const before = line;
      const after = await rebuildLine(tx, line.runId, line.employeeId, line.run.periodStart, line.run.periodEnd, v);
      await audit({ userId: user.id, action: "payroll.line", entity: "PayrollRun", entityId: line.runId, summary: `${user.name} adjusted ${line.employee.name} in ${line.run.number}: net ${fmt2(before.net)} to ${fmt2(after.net)}` }, tx);
      refresh();
      return `${line.employee.name} updated`;
    });
  });
}

const stepSchema = z.object({ id: z.string(), to: z.enum(["APPROVE", "VOID"]), reason: optionalText });

export async function transitionPayroll(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("payroll");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can approve or void payroll.");
    const { id, to, reason } = stepSchema.parse(formObject(fd));

    return db.$transaction(async (tx) => {
      const r = await tx.payrollRun.findUniqueOrThrow({ where: { id }, include: { lines: { include: { allocations: true, employee: true } } } });

      if (to === "APPROVE") {
        if (r.status !== "DRAFT") throw new ActionError(`${r.number} is already ${r.status.toLowerCase()}.`);
        if (r.createdById === user.id && user.role !== "SUPER_ADMIN") throw new ActionError("You prepared this payroll, so someone else has to approve it.");
        const gross = sum(r.lines.map((l) => l.gross)), net = sum(r.lines.map((l) => l.net));
        const deductions = sum(r.lines.map((l) => l.deductions)), advances = sum(r.lines.map((l) => l.advanceRecovered));
        if (gross.isZero()) throw new ActionError("This payroll has nothing to pay.");

        // Re-check advances: another run may have recovered them since this one was prepared.
        for (const l of r.lines.filter((x) => x.advanceRecovered.greaterThan(0))) {
          if (D(l.advanceRecovered).greaterThan(await outstandingAdvance(tx, l.employeeId))) throw new ActionError(`${l.employee.name} no longer owes that much in advances. Adjust the line first.`);
        }
        // Wages are a cost of each project where the work was done; the credits settle against payables.
        const byProject = new Map<string | null, ReturnType<typeof D>>();
        for (const a of r.lines.flatMap((l) => l.allocations)) byProject.set(a.projectId, (byProject.get(a.projectId) ?? ZERO).plus(a.amount));
        await postEntry(tx, {
          date: r.periodEnd, description: `${r.number} payroll ${r.periodStart.toISOString().slice(0, 10)} to ${r.periodEnd.toISOString().slice(0, 10)}`, reference: r.number, sourceType: "PAYROLL", sourceId: r.id, createdById: user.id,
          lines: [
            ...[...byProject.entries()].map(([projectId, amount]) => ({ accountCode: SYS.WAGES_EXPENSE, projectId, debit: amount, memo: "Wages" })),
            { accountCode: SYS.WAGES_PAYABLE, credit: net, memo: "Net pay owed" },
            ...(deductions.greaterThan(0) ? [{ accountCode: SYS.DEDUCTIONS_PAYABLE, credit: deductions }] : []),
            ...(advances.greaterThan(0) ? [{ accountCode: SYS.ADVANCES, credit: advances, memo: "Advances recovered" }] : []),
          ],
        });
        await tx.payrollRun.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
        await audit({ userId: user.id, action: "payroll.approve", entity: "PayrollRun", entityId: id, summary: `${user.name} approved ${r.number}: ${fmt2(gross)} gross, ${fmt2(net)} net to ${r.lines.length} people` }, tx);
        refresh();
        return `${r.number} approved and posted to the ledger`;
      }

      if (r.status === "VOID") throw new ActionError(`${r.number} is already void.`);
      if (!reason) throw new ActionError("Give a reason for voiding this payroll.");
      if (r.status !== "DRAFT") await reverseEntries(tx, "PAYROLL", r.id, user.id, reason);
      await tx.payrollRun.update({ where: { id }, data: { status: "VOID", notes: `Voided: ${reason}` } });
      await audit({ userId: user.id, action: "payroll.void", entity: "PayrollRun", entityId: id, summary: `${user.name} voided ${r.number}: ${reason}` }, tx);
      refresh();
      return `${r.number} voided`;
    });
  });
}

const paySchema = z.object({ id: z.string(), date, accountId: z.string().min(1, "Choose the cash or bank account."), method: z.enum(PaymentMethod, { error: "Choose how staff were paid." }), reference: optionalText });

export async function payPayroll(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("payroll");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can pay payroll.");
    const v = paySchema.parse(formObject(fd));
    return db.$transaction(async (tx) => {
      const r = await tx.payrollRun.findUniqueOrThrow({ where: { id: v.id }, include: { lines: true } });
      if (r.status !== "APPROVED") throw new ActionError(`${r.number} is ${r.status.toLowerCase()}. Only approved payroll can be paid.`);
      const acc = await tx.account.findUniqueOrThrow({ where: { id: v.accountId } });
      if (!acc.isCash) throw new ActionError("Pay from a cash or bank account.");
      const net = sum(r.lines.map((l) => l.net));
      await postEntry(tx, { date: v.date, description: `${r.number} wages paid`, reference: v.reference ?? r.number, sourceType: "PAYROLL", sourceId: r.id, createdById: user.id,
        lines: [{ accountCode: SYS.WAGES_PAYABLE, debit: net }, { accountId: acc.id, credit: net }] });
      await tx.payrollRun.update({ where: { id: v.id }, data: { status: "PAID", paidAt: v.date, payAccountId: acc.id, payMethod: v.method, payReference: v.reference ?? null } });
      await audit({ userId: user.id, action: "payroll.pay", entity: "PayrollRun", entityId: v.id, summary: `${user.name} paid ${r.number}: ${fmt2(net)} from ${acc.name}` }, tx);
      refresh();
      return `${r.number} paid, ${fmt2(net)}`;
    });
  });
}
