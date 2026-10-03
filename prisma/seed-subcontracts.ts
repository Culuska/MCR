import "dotenv/config";
import { db } from "../src/lib/db";
import { postEntry } from "../src/lib/ledger";
import { nextNumber } from "../src/lib/sequence";
import { SYS } from "../src/lib/domain";
import { certify } from "../src/lib/subcontract";

// Phase 5 seed. Adds the Retention Payable account if missing, and sample subcontracts only when there are none.

const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };

async function main() {
  await db.account.upsert({ where: { code: SYS.RETENTION }, create: { code: SYS.RETENTION, name: "Retention Payable", type: "LIABILITY", isSystem: true }, update: {} });
  if ((await db.subcontract.count()) > 0) { console.log("Subcontracts already exist. Sample subcontracts skipped."); return; }

  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const pm = await db.user.findFirstOrThrow({ where: { role: "PROJECT_MANAGER" } });
  const p1 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-01" } });
  const p2 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-02" } });
  const bank = await db.account.findUniqueOrThrow({ where: { code: "1010" } });

  const supplier = (name: string) => db.supplier.create({ data: { name, paymentTerms: "On certification" } });
  const [electric, civil, plaster, painter] = await Promise.all([
    supplier("Sample Electrical Contractors"), supplier("Sample Drainage and Civil Works"), supplier("Sample Plastering Crew"), supplier("Sample Painting and Finishes"),
  ]);

  async function subcontract(o: { supplier: string; project: string; scope: string; value: number; retention: number; status: "DRAFT" | "ACTIVE" | "COMPLETED"; start: number; end: number }) {
    return db.$transaction(async (tx) => {
      const number = await nextNumber(tx, "SUB");
      return tx.subcontract.create({ data: { number, supplierId: o.supplier, projectId: o.project, scope: o.scope, contractValue: o.value, retentionPct: o.retention, status: o.status, startDate: day(o.start), endDate: day(o.end), createdById: pm.id } });
    });
  }

  // A certificate states the work done to date. Approving posts the full cost to the project, owes the net, and holds the retention.
  async function certificate(sub: { id: string; projectId: string; retentionPct: unknown }, o: { seq: number; toDate: number; previous: number; revised: number; date: number; state: "DRAFT" | "APPROVED" | "PAID"; paid?: number }) {
    const c = certify({ revisedValue: o.revised, retentionPct: sub.retentionPct as never, previousToDate: o.previous, workToDate: o.toDate });
    await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, "CRT");
      const cert = await tx.subCertificate.create({ data: {
        number, subcontractId: sub.id, seq: o.seq, date: day(o.date), workToDate: o.toDate, gross: c.gross, retention: c.retention, net: c.net, createdById: pm.id,
        status: o.state, approvedById: o.state === "DRAFT" ? null : admin.id, approvedAt: o.state === "DRAFT" ? null : day(o.date),
        paidAt: o.state === "PAID" ? day(o.paid!) : null, payAccountId: o.state === "PAID" ? bank.id : null, payMethod: o.state === "PAID" ? "BANK_TRANSFER" : null,
      } });
      if (o.state === "DRAFT") return;
      await postEntry(tx, { date: day(o.date), description: `${number} subcontract certificate`, reference: number, sourceType: "SUBCONTRACT", sourceId: cert.id, createdById: admin.id,
        lines: [
          { accountCode: SYS.SUBCONTRACT_EXPENSE, projectId: sub.projectId, debit: c.gross },
          { accountCode: SYS.AP, projectId: sub.projectId, credit: c.net },
          ...(c.retention.greaterThan(0) ? [{ accountCode: SYS.RETENTION, projectId: sub.projectId, credit: c.retention }] : []),
        ] });
      if (o.state === "PAID") {
        await postEntry(tx, { date: day(o.paid!), description: `${number} paid`, reference: number, sourceType: "SUBCONTRACT", sourceId: cert.id, createdById: admin.id,
          lines: [{ accountCode: SYS.AP, projectId: sub.projectId, debit: c.net }, { accountId: bank.id, projectId: sub.projectId, credit: c.net }] });
      }
    });
  }

  // Electrical works on the clinic: one variation approved, one certificate paid, one approved and waiting, and the programme is behind.
  const a = await subcontract({ supplier: electric.id, project: p1.id, scope: "Electrical first and second fix, clinic building", value: 40000, retention: 5, status: "ACTIVE", start: -60, end: 40 });
  await db.subVariation.create({ data: { subcontractId: a.id, description: "Extra sockets and data points, consulting rooms", amount: 3000, approved: true, approvedById: admin.id, createdById: pm.id } });
  await certificate(a, { seq: 1, toDate: 16000, previous: 0, revised: 43000, date: -45, state: "PAID", paid: -40 });
  await certificate(a, { seq: 2, toDate: 28000, previous: 16000, revised: 43000, date: -12, state: "APPROVED" });
  await db.subScheduleItem.createMany({ data: [
    { subcontractId: a.id, description: "First fix complete", amount: 16000, dueDate: day(-50) },
    { subcontractId: a.id, description: "Second fix, ground and first floor", amount: 14000, dueDate: day(-10) },
    { subcontractId: a.id, description: "Final fix, testing and handover", amount: 13000, dueDate: day(25) },
  ] });

  // Drainage on the road: one paid, one draft waiting for finance.
  const b = await subcontract({ supplier: civil.id, project: p2.id, scope: "Storm drainage, culverts and manholes along the market road", value: 90000, retention: 10, status: "ACTIVE", start: -40, end: 120 });
  await certificate(b, { seq: 1, toDate: 30000, previous: 0, revised: 90000, date: -30, state: "PAID", paid: -26 });
  await certificate(b, { seq: 2, toDate: 52000, previous: 30000, revised: 90000, date: -3, state: "DRAFT" });
  await db.subScheduleItem.createMany({ data: [
    { subcontractId: b.id, description: "Trenching and bedding complete", amount: 30000, dueDate: day(-28) },
    { subcontractId: b.id, description: "Pipes and culverts laid", amount: 35000, dueDate: day(20) },
    { subcontractId: b.id, description: "Manholes, backfill and testing", amount: 25000, dueDate: day(90) },
  ] });

  // Plastering finished and fully paid, with its retention still held.
  const c = await subcontract({ supplier: plaster.id, project: p1.id, scope: "Internal and external plastering, clinic building", value: 12000, retention: 5, status: "COMPLETED", start: -90, end: -20 });
  await certificate(c, { seq: 1, toDate: 7000, previous: 0, revised: 12000, date: -60, state: "PAID", paid: -55 });
  await certificate(c, { seq: 2, toDate: 12000, previous: 7000, revised: 12000, date: -25, state: "PAID", paid: -21 });

  // A draft nobody has signed off yet.
  await subcontract({ supplier: painter.id, project: p2.id, scope: "Painting and finishes, site offices and stores", value: 15000, retention: 5, status: "DRAFT", start: 10, end: 60 });

  console.log("Added 4 sample subcontracts with certificates, a variation, programmes and retention.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
