import "dotenv/config";
import { db } from "../src/lib/db";
import { companyPosition, payables, projectCosting, subcontractFigures } from "../src/lib/finance";
import { D, ZERO, round2, sum } from "../src/lib/money";

let bad = 0;
const flag = (ok: boolean, text: string) => { if (!ok) bad++; console.log(ok ? "ok  " : "FAIL", text); };

async function main() {
  const subs = await db.subcontract.findMany({ include: { certificates: { orderBy: { seq: "asc" } }, releases: true, variations: true } });

  // 1. Every certificate adds up, and the running total is continuous.
  for (const s of subs) {
    const posted = s.certificates.filter((c) => c.status === "APPROVED" || c.status === "PAID");
    let previous = ZERO;
    for (const c of posted) {
      flag(D(c.workToDate).minus(previous).equals(c.gross), `${s.number} ${c.number}: work to date ${c.workToDate} less previous ${previous} = gross ${c.gross}`);
      flag(round2(D(c.gross).times(s.retentionPct).div(100)).equals(c.retention) && D(c.gross).minus(c.retention).equals(c.net), `${s.number} ${c.number}: retention ${c.retention} and net ${c.net} are correct`);
      previous = D(c.workToDate);
    }
    const revised = D(s.contractValue).plus(sum(s.variations.filter((v) => v.approved).map((v) => v.amount)));
    flag(previous.lessThanOrEqualTo(revised), `${s.number}: certified ${previous} does not exceed the contract value ${revised}`);
  }

  // 2. The retention liability in the ledger equals retention held across all subcontracts.
  const figs = await subcontractFigures();
  const held = sum(figs.map((f) => f.retentionHeld));
  const pos = await companyPosition();
  const retentionLedger = pos.rows.find((r) => r.code === "2320")?.balance ?? ZERO;
  flag(held.equals(retentionLedger), `retention held ${held.toFixed(2)} = ledger Retention Payable ${retentionLedger.toFixed(2)}`);

  // 3. Accounts Payable in the ledger equals unpaid expenses plus approved unpaid certificates plus other approved bills.
  const owedExpenses = sum((await payables()).map((p) => p.outstanding));
  const owedCerts = sum(figs.map((f) => f.unpaid));
  console.log(`   payable: expenses ${owedExpenses.toFixed(2)} + certificates ${owedCerts.toFixed(2)} = ${owedExpenses.plus(owedCerts).toFixed(2)} | ledger ${pos.payable.toFixed(2)}`);
  flag(owedExpenses.plus(owedCerts).equals(pos.payable), "Accounts Payable in the ledger = unpaid expenses + approved unpaid certificates");

  // 4. A project's subcontractor cost includes the full gross of its approved certificates.
  for (const code of [...new Set(subs.map((s) => s.projectId))]) {
    const p = await db.project.findUniqueOrThrow({ where: { id: code } });
    const c = await projectCosting(p.id);
    const gross = sum(subs.filter((s) => s.projectId === p.id).flatMap((s) => s.certificates).filter((x) => x.status === "APPROVED" || x.status === "PAID").map((x) => x.gross));
    const direct = await db.expense.aggregate({ where: { projectId: p.id, category: "SUBCONTRACTORS", status: { in: ["APPROVED", "PAID"] } }, _sum: { amount: true } });
    const want = gross.plus(D(direct._sum.amount));
    const got = c.lines.find((l) => l.category === "SUBCONTRACTORS")?.spent ?? ZERO;
    flag(got.equals(want), `${p.code}: subcontractor cost ${got.toFixed(2)} = certificates ${gross.toFixed(2)} + direct expenses ${D(direct._sum.amount).toFixed(2)}`);
  }

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
}
main().finally(() => db.$disconnect());
