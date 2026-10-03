import "dotenv/config";
import { db } from "../src/lib/db";

// Removes everything the subcontract seed and test created, including ledger entries, so it can be reseeded.
// For sample data only. Real books are corrected by reversal, never by deletion.
async function main() {
  const subs = await db.subcontract.findMany({ include: { supplier: true, certificates: { select: { id: true } }, releases: { select: { id: true } } } });
  if (subs.some((s) => !s.supplier.name.includes("Sample"))) throw new Error("Refusing to reset: a subcontract belongs to a supplier that is not marked Sample.");

  const sourceIds = subs.flatMap((s) => [...s.certificates.map((c) => c.id), ...s.releases.map((r) => r.id)]);
  const entries = await db.journalEntry.findMany({ where: { sourceId: { in: sourceIds } }, select: { id: true } });
  const ids = entries.map((e) => e.id);
  const supplierIds = [...new Set(subs.map((s) => s.supplierId))];

  await db.$transaction(async (tx) => {
    await tx.journalEntry.updateMany({ where: { id: { in: ids } }, data: { reversesId: null } });
    await tx.journalLine.deleteMany({ where: { entryId: { in: ids } } });
    await tx.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await tx.retentionRelease.deleteMany({});
    await tx.subCertificate.deleteMany({});
    await tx.subVariation.deleteMany({});
    await tx.subScheduleItem.deleteMany({});
    await tx.subcontract.deleteMany({});
    // The seed creates its own subcontractors, so remove them too if nothing else refers to them.
    for (const id of supplierIds) {
      const used = (await tx.expense.count({ where: { supplierId: id } })) + (await tx.rental.count({ where: { supplierId: id } })) + (await tx.purchaseOrder.count({ where: { supplierId: id } }));
      if (!used) await tx.supplier.delete({ where: { id } });
    }
    await tx.auditLog.deleteMany({ where: { entity: "Subcontract" } });
    await tx.sequence.deleteMany({ where: { key: { in: ["SUB", "CRT", "RET"] } } });
  });
  console.log(`removed ${subs.length} subcontracts, ${ids.length} ledger entries and their certificates, releases and variations`);
}
main().finally(() => db.$disconnect());
