import "dotenv/config";
import { db } from "../src/lib/db";
import { companyPosition, projectCosting, receivables, payables } from "../src/lib/finance";

async function main() {
  const t = await db.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  console.log("debits  ", t._sum.debit?.toString());
  console.log("credits ", t._sum.credit?.toString(), t._sum.debit?.equals(t._sum.credit!) ? "BALANCED" : "OUT OF BALANCE");
  const p = await companyPosition();
  console.log("cash", p.cash.toString(), "AR", p.receivable.toString(), "AP", p.payable.toString(), "revenue", p.revenue.toString(), "expenses", p.expenses.toString(), "profit", p.netProfit.toString());
  console.log("assets", p.assets.toString(), "= liabilities", p.liabilities.toString(), "+ equity", p.equity.plus(p.netProfit).toString());
  const ar = (await receivables()).reduce((a, i) => a.plus(i.outstanding), p.cash.minus(p.cash));
  const ap = (await payables()).reduce((a, i) => a.plus(i.outstanding), p.cash.minus(p.cash));
  console.log("open invoices total", ar.toString(), "| open payables total", ap.toString());
  for (const pr of await db.project.findMany({ orderBy: { code: "asc" } })) {
    const c = await projectCosting(pr.id);
    console.log(pr.code, "cost", c.cost.toString(), "budget", c.budget.toString(), "invoiced", c.invoiced.toString(), "received", c.received.toString(), "expectedProfit", c.expectedProfit.toString());
  }
}
main().finally(() => db.$disconnect());
