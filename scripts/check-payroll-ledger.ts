import "dotenv/config";
import { db } from "../src/lib/db";
import { companyPosition, projectCosting } from "../src/lib/finance";
import { advanceBalances } from "../src/lib/workforce";

async function main() {
  const t = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  console.log("ledger", t._sum.debit?.toString(), "=", t._sum.credit?.toString(), t._sum.debit?.equals(t._sum.credit!) ? "BALANCED" : "OUT OF BALANCE");
  const p = await companyPosition();
  const bal = (c: string) => p.rows.find((r) => r.code === c)!.balance.toString();
  console.log("wages payable 2300 (should be 0 once paid):", bal("2300"), "| deductions payable 2310:", bal("2310"), "| employee advances 1300 (should be 20):", bal("1300"));
  console.log("assets", p.assets.toString(), "= liabilities + equity + profit", p.liabilities.plus(p.equity).plus(p.netProfit).toString());
  for (const code of ["MCR-2026-01", "MCR-2026-02"]) {
    const pr = await db.project.findUniqueOrThrow({ where: { code } });
    const c = await projectCosting(pr.id);
    console.log(code, "WAGES actual:", c.lines.find((l) => l.category === "WAGES")?.spent.toString(), "| total cost:", c.cost.toString());
  }
  const emp = await db.employee.findFirstOrThrow({ where: { name: { startsWith: "Labourer 1" } } });
  console.log("Labourer 1 owes:", (await advanceBalances(db, [emp.id])).get(emp.id)?.toString());
}
main().finally(() => db.$disconnect());
