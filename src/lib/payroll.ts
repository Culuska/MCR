import { D, ZERO, round2, sum, type Amount, type Money } from "@/lib/money";

// All pay rules live here, so the payroll screen, the seed and the tests agree.
//
//  DAILY    base pay   = daily wage x paid days
//  MONTHLY  base pay   = monthly salary / 26 x paid days, capped at a full month
//  Paid days: present = 1, half day = 0.5, leave = 1 for monthly staff and 0 for daily staff, absent = 0.
//  Days with no attendance record are not paid. Overtime counts only on days someone was at work.
//  Gross = base + overtime + bonus.  Net = gross - deductions - advance recovered.

export const WORKDAYS_PER_MONTH = 26;

type Status = "PRESENT" | "HALF_DAY" | "ABSENT" | "LEAVE";
export type PayDay = { status: Status; overtimeHours: Amount; projectId: string | null };
export type PayEmployee = { payType: "DAILY" | "MONTHLY"; rate: Amount; overtimeRate: Amount };
export type PayAdjustments = { bonus?: Amount; deductions?: Amount; advanceRecovered?: Amount };
export type Allocation = { projectId: string | null; amount: Money };


export function dayWeight(status: Status, payType: "DAILY" | "MONTHLY"): number {
  if (status === "PRESENT") return 1;
  if (status === "HALF_DAY") return 0.5;
  if (status === "LEAVE") return payType === "MONTHLY" ? 1 : 0;
  return 0;
}

// Splits an amount across buckets in proportion to their weights, to the cent, with no money lost to rounding.
function split(total: Money, weights: Map<string | null, number>): Allocation[] {
  const entries = [...weights.entries()].filter(([, w]) => w > 0);
  const totalWeight = entries.reduce((a, [, w]) => a + w, 0);
  if (total.isZero() || totalWeight === 0) return total.isZero() ? [] : [{ projectId: null, amount: total }];
  const parts = entries.map(([projectId, w]) => ({ projectId, amount: round2(total.times(w).div(totalWeight)) }));
  const drift = total.minus(sum(parts.map((p) => p.amount)));
  if (!drift.isZero()) {
    const biggest = parts.reduce((a, b) => (b.amount.greaterThan(a.amount) ? b : a));
    biggest.amount = biggest.amount.plus(drift);
  }
  return parts;
}

export function computePay(emp: PayEmployee, days: PayDay[], periodDays: number, adj: PayAdjustments = {}) {
  const weights = new Map<string | null, number>();
  const otHours = new Map<string | null, Money>();
  let paidDays = 0;
  for (const d of days) {
    const w = dayWeight(d.status, emp.payType);
    paidDays += w;
    if (w > 0) weights.set(d.projectId, (weights.get(d.projectId) ?? 0) + w);
    if (d.status === "PRESENT" || d.status === "HALF_DAY") otHours.set(d.projectId, (otHours.get(d.projectId) ?? ZERO).plus(D(d.overtimeHours)));
  }

  const rate = D(emp.rate);
  const monthlyCap = WORKDAYS_PER_MONTH * Math.max(1, Math.ceil(periodDays / 31));
  const basePay = emp.payType === "DAILY" ? round2(rate.times(paidDays)) : round2(rate.div(WORKDAYS_PER_MONTH).times(Math.min(paidDays, monthlyCap)));

  const overtimeHours = sum([...otHours.values()]);
  const otRate = D(emp.overtimeRate);
  const otParts = [...otHours.entries()].filter(([, h]) => h.greaterThan(0)).map(([projectId, h]) => ({ projectId, amount: round2(h.times(otRate)) }));
  const overtimePay = round2(overtimeHours.times(otRate));
  const otDrift = overtimePay.minus(sum(otParts.map((p) => p.amount)));
  if (otParts.length && !otDrift.isZero()) otParts[0].amount = otParts[0].amount.plus(otDrift);

  const bonus = D(adj.bonus), deductions = D(adj.deductions), advanceRecovered = D(adj.advanceRecovered);
  const gross = basePay.plus(overtimePay).plus(bonus);
  const net = gross.minus(deductions).minus(advanceRecovered);

  // Cost goes to the projects where the person actually worked. Bonus follows the same split as base pay.
  const allocation = new Map<string | null, Money>();
  for (const a of [...split(basePay.plus(bonus), weights), ...otParts]) allocation.set(a.projectId, (allocation.get(a.projectId) ?? ZERO).plus(a.amount));
  const allocations: Allocation[] = [...allocation.entries()].filter(([, amount]) => !amount.isZero()).map(([projectId, amount]) => ({ projectId, amount }));

  return { paidDays, overtimeHours, basePay, overtimePay, bonus, deductions, advanceRecovered, gross, net, allocations };
}
