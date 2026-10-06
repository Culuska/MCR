import "dotenv/config";
import { D, type Money } from "../src/lib/money";
import { balanceSheet, layout, parseDay, type Acct } from "../src/lib/balance-sheet";
import { db } from "../src/lib/db";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};

const acct = (code: string, name: string, type: Acct["type"], isCash = false): Acct => ({ id: code, code, name, type, isCash });
const ACCOUNTS: Acct[] = [
  acct("1000", "Cash on Hand", "ASSET", true), acct("1010", "Bank", "ASSET", true), acct("1100", "Accounts Receivable", "ASSET"), acct("1200", "Inventory", "ASSET"),
  acct("1500", "Equipment", "ASSET"), acct("2000", "Accounts Payable", "LIABILITY"), acct("2100", "Loans", "LIABILITY"), acct("2300", "Wages Payable", "LIABILITY"), acct("3000", "Owner's Equity", "EQUITY"),
];
const bal = (o: Record<string, number>) => new Map<string, Money>(Object.entries(o).map(([k, v]) => [k, D(v)]));
const labels = (r: ReturnType<typeof layout>) => r.lines.map((l) => `${"  ".repeat(l.indent)}${l.label}`);

async function main() {
  // One column. Assets 1000 + 500 + 300 + 200 + 4000 = 6000; liabilities 700 + 1000 + 100 = 1800; equity 3000 + retained 900 + net 300 = 4200.
  const one = layout(ACCOUNTS, [bal({ "1000": 1000, "1010": 500, "1100": 300, "1200": 200, "1500": 4000, "2000": 700, "2100": 1000, "2300": 100, "3000": 3000 })], [D(900)], [D(300)]);
  eq("total assets", one.assets[0], 6000);
  eq("total liabilities and equity", one.liabilitiesAndEquity[0], 6000);
  eq("it balances", one.balanced, true);
  const text = labels(one);
  eq("starts with Assets", text[0], "Assets");
  eq("bank accounts are grouped and totalled", text.includes("      Cash on Hand") && text.includes("    Total Bank Accounts"), true);
  eq("receivable is one line", text.includes("    Accounts Receivable (A/R)"), true);
  eq("other current assets are grouped", text.includes("    Other Current Assets") && text.includes("      Inventory"), true);
  eq("fixed assets are grouped", text.includes("  Fixed Assets") && text.includes("  Total Fixed Assets"), true);
  eq("current liabilities hold payable and the rest", text.includes("    Current Liabilities") && text.includes("      Accounts Payable (A/P)") && text.includes("      Other Current Liabilities"), true);
  eq("loans are long term", text.includes("    Long-Term Liabilities") && text.includes("      Loans"), true);
  eq("equity shows retained earnings and net income", text.includes("    Retained Earnings") && text.includes("    Net Income"), true);
  eq("ends with the grand total", text[text.length - 1], "Total Liabilities and Equity");
  const currentAssets = one.lines.find((l) => l.label === "Total Current Assets")!;
  eq("current assets add up", currentAssets.amounts![0], 2000);
  const equityTotal = one.lines.find((l) => l.label === "Total Equity")!;
  eq("equity adds up", equityTotal.amounts![0], 4200);

  // Zero accounts and empty groups are left out, but the two grand totals always show.
  const empty = layout(ACCOUNTS, [bal({})], [D(0)], [D(0)]);
  eq("an empty company still shows both totals", labels(empty).join("|"), "Assets|Total Assets|Liabilities and Equity|Total Liabilities and Equity");
  eq("and balances at zero", empty.balanced, true);
  const noFixed = layout(ACCOUNTS, [bal({ "1000": 100, "3000": 100 })], [D(0)], [D(0)]);
  eq("no fixed assets, no Fixed Assets heading", labels(noFixed).some((l) => l.includes("Fixed")), false);

  // Two columns (compare with an earlier date) are carried through every line.
  const two = layout(ACCOUNTS, [bal({ "1000": 100, "3000": 100 }), bal({ "1000": 250, "3000": 100, "2000": 150 })], [D(0), D(0)], [D(0), D(0)]);
  eq("two columns of assets", `${two.assets[0]}/${two.assets[1]}`, "100/250");
  eq("two columns balance", two.balanced, true);
  eq("every amount line has two amounts", two.lines.filter((l) => l.amounts).every((l) => l.amounts!.length === 2), true);

  // An unbalanced ledger is reported, not hidden.
  eq("a ledger that does not balance is flagged", layout(ACCOUNTS, [bal({ "1000": 100, "3000": 90 })], [D(0)], [D(0)]).balanced, false);

  // Dates.
  eq("a real date parses", parseDay("2026-10-06")?.toISOString(), "2026-10-06T00:00:00.000Z");
  eq("a made-up date is refused", parseDay("2026-02-31"), undefined);
  eq("text is refused", parseDay("tomorrow"), undefined);

  // The real ledger: the sheet must balance at any date, and agree with the books.
  const today = parseDay(new Date().toISOString().slice(0, 10))!;
  for (const d of ["2025-12-31", "2026-01-01", "2026-03-31", "2026-06-30", today.toISOString().slice(0, 10), "2027-12-31"]) {
    const sheet = await balanceSheet([parseDay(d)!]);
    eq(`ledger balances as of ${d}`, `${sheet.balanced} ${sheet.assets[0]} = ${sheet.liabilitiesAndEquity[0]}`, `true ${sheet.assets[0]} = ${sheet.assets[0]}`);
  }
  const all = await balanceSheet([today]);
  const lines = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  const accounts = await db.account.findMany();
  const sums = await db.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } });
  const assets = accounts.filter((a) => a.type === "ASSET").reduce((t, a) => { const s = sums.find((x) => x.accountId === a.id)?._sum; return t.plus(D(s?.debit).minus(D(s?.credit))); }, D(0));
  eq("total assets agree with the account balances", all.assets[0].toFixed(2), assets.toFixed(2));
  eq("the ledger itself balances", D(lines._sum.debit).equals(D(lines._sum.credit)), true);
  const early = await balanceSheet([parseDay("2025-12-31")!]);
  eq("before the books start, assets are zero", early.assets[0].toFixed(2), "0.00");
  const both = await balanceSheet([today, parseDay("2026-01-01")!]);
  eq("a comparison has two columns", both.lines.find((l) => l.kind === "grand")!.amounts!.length, 2);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main();
