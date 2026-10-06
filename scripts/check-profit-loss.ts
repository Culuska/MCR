import "dotenv/config";
import { D, type Money } from "../src/lib/money";
import { balanceSheet, parseDay, todayDay, type Acct } from "../src/lib/balance-sheet";
import { layout, periodFrom, previousPeriod, profitAndLoss } from "../src/lib/profit-loss";
import { db } from "../src/lib/db";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const day = (s: string) => parseDay(s)!;
const acct = (code: string, name: string, type: Acct["type"]): Acct => ({ id: code, code, name, type, isCash: false });
const ACCOUNTS: Acct[] = [
  acct("4000", "Construction Revenue", "INCOME"), acct("4100", "Other Income", "INCOME"), acct("5010", "Payroll and Wages", "EXPENSE"), acct("5020", "Materials", "EXPENSE"),
  acct("5070", "Rent", "EXPENSE"), acct("5900", "Other Operating Expenses", "EXPENSE"),
];
const bal = (o: Record<string, number>) => new Map<string, Money>(Object.entries(o).map(([k, v]) => [k, D(v)]));
const find = (r: ReturnType<typeof layout>, label: string) => r.lines.find((l) => l.label === label)!;

async function main() {
  // Revenue 10,000. Job costs 3,000 + 2,000. Overhead 800 + 200. Other income 150.
  const r = layout(ACCOUNTS, [bal({ "4000": 10000, "4100": 150, "5010": 3000, "5020": 2000, "5070": 800, "5900": 200 })]);
  eq("total income", find(r, "Total Income").amounts![0], 10000);
  eq("cost of construction", find(r, "Total Cost of Construction").amounts![0], 5000);
  eq("gross profit", find(r, "Gross Profit").amounts![0], 5000);
  eq("overhead expenses", find(r, "Total Expenses").amounts![0], 1000);
  eq("net operating income", find(r, "Net Operating Income").amounts![0], 4000);
  eq("other income sits below operating income", find(r, "Total Other Income").amounts![0], 150);
  eq("net income", find(r, "Net Income").amounts![0], 4150);
  eq("sections come in the QuickBooks order", r.lines.filter((l) => l.kind === "title" || l.kind === "grand" || ["Gross Profit", "Net Operating Income"].includes(l.label)).map((l) => l.label).join(" > "),
    "Income > Cost of Construction > Gross Profit > Expenses > Net Operating Income > Other Income > Net Income");
  const labels = r.lines.map((l) => l.label);
  eq("other income is listed after Net Operating Income, not among sales", labels.lastIndexOf("Other Income") > labels.indexOf("Net Operating Income") && labels.indexOf("Other Income") > labels.indexOf("Net Operating Income"), true);

  // Empty groups are left out; Income, Gross Profit, Net Operating Income and Net Income always show.
  const quiet = layout(ACCOUNTS, [bal({ "4000": 500 })]);
  eq("only revenue: no cost or expense sections", quiet.lines.map((l) => l.label).join("|"), "Income|Construction Revenue|Total Income|Gross Profit|Net Operating Income|Net Income");
  eq("a loss shows as a negative net income", layout(ACCOUNTS, [bal({ "5010": 700 })]).netIncome[0], -700);
  eq("an empty company has zero net income", layout(ACCOUNTS, [bal({})]).netIncome[0], 0);

  // Two periods side by side.
  const two = layout(ACCOUNTS, [bal({ "4000": 900, "5020": 300 }), bal({ "4000": 400, "5020": 100 })]);
  eq("two columns of net income", `${two.netIncome[0]}/${two.netIncome[1]}`, "600/300");
  eq("every amount line carries both", two.lines.filter((l) => l.amounts).every((l) => l.amounts!.length === 2), true);

  // Periods.
  const p = periodFrom("2026-03-01", "2026-03-31");
  eq("the previous period has the same length", `${previousPeriod(p).from.toISOString().slice(0, 10)} to ${previousPeriod(p).to.toISOString().slice(0, 10)}`, "2026-01-29 to 2026-02-28");
  eq("a reversed range is swapped", `${periodFrom("2026-05-10", "2026-05-01").from.toISOString().slice(0, 10)}`, "2026-05-01");
  eq("the default period starts on 1 January", periodFrom(undefined, "2026-08-15").from.toISOString().slice(0, 10), "2026-01-01");
  eq("the default end is today", periodFrom().to.toISOString().slice(0, 10), todayDay().toISOString().slice(0, 10));
  eq("a made-up date falls back to the default", periodFrom("2026-02-31", "2026-06-30").from.toISOString().slice(0, 10), "2026-01-01");

  // The real ledger.
  const today = todayDay();
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const ytd = await profitAndLoss([{ from: yearStart, to: today }]);
  const sheet = await balanceSheet([today]);
  const bsNet = sheet.lines.find((l) => l.label === "Net Income")?.amounts![0] ?? D(0);
  eq("net income agrees with the Balance Sheet's Net Income", ytd.netIncome[0].toFixed(2), bsNet.toFixed(2));

  const first = await profitAndLoss([{ from: yearStart, to: day("2026-06-30") }]);
  const second = await profitAndLoss([{ from: day("2026-07-01"), to: today }]);
  eq("two halves of the year add up to the whole year", first.netIncome[0].plus(second.netIncome[0]).toFixed(2), ytd.netIncome[0].toFixed(2));

  const lines = await db.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } });
  const accounts = await db.account.findMany();
  const all = await profitAndLoss([{ from: day("2000-01-01"), to: day("2099-12-31") }]);
  const profit = accounts.reduce((t, a) => { const s = lines.find((x) => x.accountId === a.id)?._sum; const net = D(s?.credit).minus(D(s?.debit)); return a.type === "INCOME" ? t.plus(net) : a.type === "EXPENSE" ? t.plus(net) : t; }, D(0));
  eq("all-time net income equals income less expenses in the books", all.netIncome[0].toFixed(2), profit.toFixed(2));
  const compare = await profitAndLoss([{ from: yearStart, to: today }, previousPeriod({ from: yearStart, to: today })]);
  eq("a comparison has two columns", compare.lines.find((l) => l.kind === "grand")!.amounts!.length, 2);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main();
