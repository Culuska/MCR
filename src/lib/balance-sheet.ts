import { db } from "@/lib/db";
import { ZERO, type Money } from "@/lib/money";
import type { AccountType } from "@/generated/prisma/client";

// The Balance Sheet, laid out the way QuickBooks shows it: Assets, then Liabilities and Equity, with grouped accounts and totals.
// `layout` is pure (accounts and balances in, lines out) so it can be tested without a database; `balanceSheet` reads the ledger.
// The financial year is the calendar year: profit before 1 January is Retained Earnings, profit since is Net Income.

export type Acct = { id: string; code: string; name: string; type: AccountType; isCash: boolean };
export type Line = { kind: "title" | "row" | "total" | "grand"; indent: number; label: string; amounts: Money[] | null; accountId?: string };
export type BalanceSheet = { dates: Date[]; lines: Line[]; assets: Money[]; liabilitiesAndEquity: Money[]; balanced: boolean };

type Piece = { lines: Line[]; total: Money[] } | null;

export function layout(accounts: Acct[], balances: Map<string, Money>[], retained: Money[], netIncome: Money[]) {
  const cols = balances.length;
  const zero = () => Array.from({ length: cols }, () => ZERO);
  const add = (list: Money[][]) => list.reduce((t, r) => t.map((x, i) => x.plus(r[i])), zero());
  const nonZero = (v: Money[]) => v.some((x) => !x.isZero());
  const withAmounts = (list: Acct[]) => list.map((a) => ({ a, v: balances.map((m) => m.get(a.id) ?? ZERO) })).filter((r) => nonZero(r.v));
  const byType = (t: AccountType) => accounts.filter((a) => a.type === t);

  // A titled group of accounts with its own total ("Bank Accounts" ... "Total Bank Accounts").
  const group = (title: string, list: Acct[], indent: number): Piece => {
    const rows = withAmounts(list);
    if (!rows.length) return null;
    const total = add(rows.map((r) => r.v));
    return { total, lines: [
      { kind: "title", indent, label: title, amounts: null },
      ...rows.map((r): Line => ({ kind: "row", indent: indent + 1, label: r.a.name, amounts: r.v, accountId: r.a.id })),
      { kind: "total", indent, label: `Total ${title}`, amounts: total },
    ] };
  };
  // One account shown on a single line (Accounts Receivable, Accounts Payable).
  const single = (label: string, a: Acct | undefined, indent: number): Piece => {
    const rows = a ? withAmounts([a]) : [];
    return rows.length ? { total: rows[0].v, lines: [{ kind: "row", indent, label, amounts: rows[0].v, accountId: rows[0].a.id }] } : null;
  };
  // A group made of other groups ("Current Assets" holding Bank Accounts, Accounts Receivable ...).
  const wrap = (title: string, indent: number, parts: Piece[]): Piece => {
    const ps = parts.filter((p): p is NonNullable<Piece> => p !== null);
    if (!ps.length) return null;
    const total = add(ps.map((p) => p.total));
    return { total, lines: [{ kind: "title", indent, label: title, amounts: null }, ...ps.flatMap((p) => p.lines), { kind: "total", indent, label: `Total ${title}`, amounts: total }] };
  };

  const assets = byType("ASSET");
  const currentAssets = wrap("Current Assets", 1, [
    group("Bank Accounts", assets.filter((a) => a.isCash), 2),
    single("Accounts Receivable (A/R)", assets.find((a) => a.code === "1100"), 2),
    group("Other Current Assets", assets.filter((a) => !a.isCash && a.code !== "1100" && a.code < "1500"), 2),
  ]);
  const fixedAssets = group("Fixed Assets", assets.filter((a) => !a.isCash && a.code !== "1100" && a.code >= "1500"), 1);
  const assetParts = [currentAssets, fixedAssets].filter((p): p is NonNullable<Piece> => p !== null);
  const totalAssets = add(assetParts.map((p) => p.total));

  const liabilities = byType("LIABILITY");
  const currentLiabilities = wrap("Current Liabilities", 2, [
    single("Accounts Payable (A/P)", liabilities.find((a) => a.code === "2000"), 3),
    group("Other Current Liabilities", liabilities.filter((a) => a.code !== "2000" && a.code !== "2100"), 3),
  ]);
  const longTerm = group("Long-Term Liabilities", liabilities.filter((a) => a.code === "2100"), 2);
  const totalLiabilitiesPiece = wrap("Liabilities", 1, [currentLiabilities, longTerm]);

  const equityRows: Line[] = [
    ...withAmounts(byType("EQUITY")).map((r): Line => ({ kind: "row", indent: 2, label: r.a.name, amounts: r.v, accountId: r.a.id })),
    ...(nonZero(retained) ? [{ kind: "row", indent: 2, label: "Retained Earnings", amounts: retained } as Line] : []),
    ...(nonZero(netIncome) ? [{ kind: "row", indent: 2, label: "Net Income", amounts: netIncome } as Line] : []),
  ];
  const totalEquity = add(equityRows.map((l) => l.amounts!));
  const equityLines: Line[] = equityRows.length ? [{ kind: "title", indent: 1, label: "Equity", amounts: null }, ...equityRows, { kind: "total", indent: 1, label: "Total Equity", amounts: totalEquity }] : [];
  const liabilitiesTotal = totalLiabilitiesPiece?.total ?? zero();
  const liabilitiesAndEquity = add([liabilitiesTotal, totalEquity]);

  const lines: Line[] = [
    { kind: "title", indent: 0, label: "Assets", amounts: null },
    ...assetParts.flatMap((p) => p.lines),
    { kind: "grand", indent: 0, label: "Total Assets", amounts: totalAssets },
    { kind: "title", indent: 0, label: "Liabilities and Equity", amounts: null },
    ...(totalLiabilitiesPiece?.lines ?? []),
    ...equityLines,
    { kind: "grand", indent: 0, label: "Total Liabilities and Equity", amounts: liabilitiesAndEquity },
  ];
  return { lines, assets: totalAssets, liabilitiesAndEquity, balanced: totalAssets.every((t, i) => t.equals(liabilitiesAndEquity[i])) };
}

const endOfDay = (d: Date) => new Date(d.getTime() + 86_399_999);

// Balance of every account using only entries dated on or before `day` (a UTC midnight).
async function balancesAsOf(accounts: Acct[], day: Date) {
  const grouped = await db.journalLine.groupBy({ by: ["accountId"], where: { entry: { date: { lte: endOfDay(day) } } }, _sum: { debit: true, credit: true } });
  const sums = new Map(grouped.map((g) => [g.accountId, g._sum]));
  const out = new Map<string, Money>();
  for (const a of accounts) {
    const s = sums.get(a.id);
    const debit = s?.debit ?? ZERO, credit = s?.credit ?? ZERO;
    out.set(a.id, a.type === "ASSET" || a.type === "EXPENSE" ? debit.minus(credit) : credit.minus(debit));
  }
  return out;
}

export async function balanceSheet(dates: Date[]): Promise<BalanceSheet> {
  const accounts: Acct[] = (await db.account.findMany({ orderBy: { code: "asc" } })).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isCash: a.isCash }));
  const profit = (m: Map<string, Money>) => accounts.reduce((t, a) => (a.type === "INCOME" ? t.plus(m.get(a.id) ?? ZERO) : a.type === "EXPENSE" ? t.minus(m.get(a.id) ?? ZERO) : t), ZERO);
  const balances: Map<string, Money>[] = [], retained: Money[] = [], netIncome: Money[] = [];
  for (const d of dates) {
    const now = await balancesAsOf(accounts, d);
    const dayBeforeYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1) - 86_400_000);
    const before = profit(await balancesAsOf(accounts, dayBeforeYear));
    balances.push(now);
    retained.push(before);
    netIncome.push(profit(now).minus(before));
  }
  return { dates, ...layout(accounts, balances, retained, netIncome) };
}

export const dateLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A YYYY-MM-DD string as a UTC midnight date, or undefined if it is not a real date. */
export function parseDay(v: string | null | undefined): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : d;
}
export const todayDay = () => parseDay(new Date().toISOString().slice(0, 10))!;
