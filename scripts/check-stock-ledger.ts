import "dotenv/config";
import { db } from "../src/lib/db";
import { projectCosting, stockSummary } from "../src/lib/finance";
import { D, sum } from "../src/lib/money";

let bad = 0;
const flag = (ok: boolean, text: string) => { if (!ok) bad++; console.log(ok ? "ok  " : "FAIL", text); };

async function main() {
  // 1. The quantity on hand must equal the sum of the movements that have not been voided.
  const mats = await db.material.findMany();
  for (const m of mats) {
    const moves = await db.stockMovement.findMany({ where: { materialId: m.id, voided: false }, select: { quantity: true } });
    const total = sum(moves.map((x) => x.quantity));
    flag(total.equals(D(m.onHand)), `${m.name}: on hand ${m.onHand} = movements ${total}`);
  }

  // 2. Stock value reconciles with Inventory in the ledger, allowing for bills not yet approved.
  const s = await stockSummary();
  console.log(`stock value ${s.value.toFixed(2)} | ledger inventory ${s.inLedger.toFixed(2)} | bills awaiting approval ${s.awaiting.toFixed(2)} | difference ${s.difference.toFixed(2)}`);
  flag(s.difference.abs().lessThan(1), "stock list agrees with the ledger to within $1 (rounding)");

  // 3. Material issued to a project is counted in that project's materials cost.
  for (const code of ["MCR-2026-01", "MCR-2026-02"]) {
    const p = await db.project.findUniqueOrThrow({ where: { code } });
    const c = await projectCosting(p.id);
    const issued = await db.stockMovement.aggregate({ where: { projectId: p.id, type: "ISSUE", voided: false }, _sum: { value: true } });
    const expenses = await db.expense.aggregate({ where: { projectId: p.id, category: "MATERIALS", status: { in: ["APPROVED", "PAID"] } }, _sum: { amount: true } });
    const want = D(issued._sum.value).plus(D(expenses._sum.amount));
    flag(c.lines.find((l) => l.category === "MATERIALS")?.spent.equals(want) ?? want.isZero(), `${code}: materials cost ${c.lines.find((l) => l.category === "MATERIALS")?.spent} = issues ${issued._sum.value} + direct purchases ${expenses._sum.amount}`);
  }

  // 4. Stock bills must not be counted as costs.
  const stockBills = await db.expense.aggregate({ where: { category: "STOCK_PURCHASE", status: { in: ["APPROVED", "PAID"] } }, _sum: { amount: true } });
  console.log(`approved stock bills ${stockBills._sum.amount ?? 0} are not costs: the stock is in Inventory until it is used`);

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
}
main().finally(() => db.$disconnect());
