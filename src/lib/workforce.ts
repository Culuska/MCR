import { db, type Tx } from "@/lib/db";
import { D, ZERO, sum, type Money } from "@/lib/money";

// What an employee still owes the company: advances paid, less what approved or paid payroll has already taken back.
export async function outstandingAdvance(client: Tx | typeof db, employeeId: string) {
  const given = await client.advance.findMany({ where: { employeeId, voided: false }, select: { amount: true } });
  const recovered = await client.payrollLine.findMany({ where: { employeeId, run: { status: { in: ["APPROVED", "PAID"] } } }, select: { advanceRecovered: true } });
  return sum(given.map((a) => a.amount)).minus(sum(recovered.map((r) => r.advanceRecovered)));
}

// Suggested payroll period: starts the day after the last run ended (or 30 days ago) and ends yesterday.
export function suggestedPeriod(lastEnd: Date | undefined) {
  const day = 86400000, now = Date.now();
  const start = lastEnd ? new Date(lastEnd.getTime() + day) : new Date(now - 30 * day);
  const end = new Date(now - day);
  return { start, end: end < start ? start : end };
}

// Advance balances for many employees at once, in two queries instead of two per person.
export async function advanceBalances(client: Tx | typeof db, employeeIds?: string[]): Promise<Map<string, Money>> {
  const only = employeeIds ? { in: employeeIds } : undefined;
  const given = await client.advance.groupBy({ by: ["employeeId"], where: { voided: false, employeeId: only }, _sum: { amount: true } });
  const recovered = await client.payrollLine.groupBy({ by: ["employeeId"], where: { employeeId: only, run: { status: { in: ["APPROVED", "PAID"] } } }, _sum: { advanceRecovered: true } });
  const back = new Map(recovered.map((r) => [r.employeeId, D(r._sum.advanceRecovered)]));
  return new Map(given.map((g) => [g.employeeId, D(g._sum.amount).minus(back.get(g.employeeId) ?? ZERO)]));
}
