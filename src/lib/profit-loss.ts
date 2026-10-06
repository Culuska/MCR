import { db } from "@/lib/db";
import { ZERO, type Money } from "@/lib/money";
import { parseDay, todayDay, type Line, type Acct } from "@/lib/balance-sheet";

// The Profit and Loss statement in the QuickBooks order: Income, Cost of Construction, Gross Profit, Expenses,
// Net Operating Income, Other Income, Net Income. Direct job costs (wages, materials, fuel, equipment, transport,
// subcontractors, site costs, tools) sit above Gross Profit; office and overhead costs sit below it.
// `layout` is pure so it can be tested without a database.

export type Period = { from: Date; to: Date };
export type ProfitLoss = { periods: Period[]; lines: Line[]; netIncome: Money[]; grossProfit: Money[] };

const DIRECT = new Set(["5010", "5020", "5030", "5040", "5050", "5060", "5080", "5120", "5130"]);
const OTHER_INCOME = "4100";

export function layout(accounts: Acct[], balances: Map<string, Money>[]) {
  const cols = balances.length;
  const zero = () => Array.from({ length: cols }, () => ZERO);
  const add = (list: Money[][]) => list.reduce((t, r) => t.map((x, i) => x.plus(r[i])), zero());
  const sub = (a: Money[], b: Money[]) => a.map((x, i) => x.minus(b[i]));
  const rowsOf = (list: Acct[]) => list.map((a) => ({ a, v: balances.map((m) => m.get(a.id) ?? ZERO) })).filter((r) => r.v.some((x) => !x.isZero()));

  const lines: Line[] = [];
  // A titled group with a total. `always` keeps the group on the page even when it is empty, so the main sections never vanish.
  const group = (title: string, list: Acct[], always: boolean): Money[] => {
    const rows = rowsOf(list);
    if (!rows.length && !always) return zero();
    const total = add(rows.map((r) => r.v));
    lines.push({ kind: "title", indent: 0, label: title, amounts: null });
    for (const r of rows) lines.push({ kind: "row", indent: 1, label: r.a.name, amounts: r.v, accountId: r.a.id });
    lines.push({ kind: "total", indent: 0, label: `Total ${title}`, amounts: total });
    return total;
  };

  const income = group("Income", accounts.filter((a) => a.type === "INCOME" && a.code !== OTHER_INCOME), true);
  const direct = group("Cost of Construction", accounts.filter((a) => a.type === "EXPENSE" && DIRECT.has(a.code)), false);
  const grossProfit = sub(income, direct);
  lines.push({ kind: "total", indent: 0, label: "Gross Profit", amounts: grossProfit });
  const overhead = group("Expenses", accounts.filter((a) => a.type === "EXPENSE" && !DIRECT.has(a.code)), false);
  const operating = sub(grossProfit, overhead);
  lines.push({ kind: "total", indent: 0, label: "Net Operating Income", amounts: operating });
  const other = group("Other Income", accounts.filter((a) => a.code === OTHER_INCOME), false);
  const netIncome = add([operating, other]);
  lines.push({ kind: "grand", indent: 0, label: "Net Income", amounts: netIncome });
  return { lines, netIncome, grossProfit };
}

const DAY = 86_400_000;
const endOfDay = (d: Date) => new Date(d.getTime() + DAY - 1);

/** The period of the same length that ends the day before this one starts. */
export function previousPeriod(p: Period): Period {
  const days = Math.round((p.to.getTime() - p.from.getTime()) / DAY) + 1;
  const to = new Date(p.from.getTime() - DAY);
  return { from: new Date(to.getTime() - (days - 1) * DAY), to };
}

export async function profitAndLoss(periods: Period[]): Promise<ProfitLoss> {
  const accounts: Acct[] = (await db.account.findMany({ orderBy: { code: "asc" } })).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isCash: a.isCash }));
  const balances: Map<string, Money>[] = [];
  for (const p of periods) {
    const grouped = await db.journalLine.groupBy({ by: ["accountId"], where: { entry: { date: { gte: p.from, lte: endOfDay(p.to) } } }, _sum: { debit: true, credit: true } });
    const sums = new Map(grouped.map((g) => [g.accountId, g._sum]));
    const m = new Map<string, Money>();
    for (const a of accounts) {
      if (a.type !== "INCOME" && a.type !== "EXPENSE") continue;
      const s = sums.get(a.id);
      const debit = s?.debit ?? ZERO, credit = s?.credit ?? ZERO;
      m.set(a.id, a.type === "EXPENSE" ? debit.minus(credit) : credit.minus(debit));
    }
    balances.push(m);
  }
  return { periods, ...layout(accounts, balances) };
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const periodLabel = (p: Period) => `${fmtDay(p.from)} to ${fmtDay(p.to)}`;

/** The period a page asks for: this calendar year to today unless dates are given. A reversed range is swapped. */
export function periodFrom(from?: string | null, to?: string | null): Period {
  const end = parseDay(to) ?? todayDay();
  const start = parseDay(from) ?? new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  return start.getTime() <= end.getTime() ? { from: start, to: end } : { from: end, to: start };
}
