import "dotenv/config";
import { db } from "../src/lib/db";

// Removes everything the materials seed created, including its ledger entries, so it can be reseeded.
// For sample data only. Real books are corrected by reversal, never by deletion.
async function main() {
  const mats = await db.material.findMany({ select: { id: true, name: true } });
  if (mats.some((m) => !m.name.includes("(sample)"))) throw new Error("Refusing to reset: there are materials that are not marked (sample).");
  const bills = await db.expense.findMany({ where: { category: "STOCK_PURCHASE" }, select: { id: true, payments: { select: { id: true } } } });
  const moves = await db.stockMovement.findMany({ select: { id: true } });
  const receipts = await db.goodsReceipt.findMany({ select: { id: true } });
  const sourceIds = [...moves.map((m) => m.id), ...receipts.map((r) => r.id), ...bills.map((b) => b.id), ...bills.flatMap((b) => b.payments.map((p) => p.id))];

  const entries = await db.journalEntry.findMany({ where: { sourceId: { in: sourceIds } }, select: { id: true } });
  const ids = entries.map((e) => e.id);
  await db.$transaction(async (tx) => {
    await tx.journalEntry.updateMany({ where: { id: { in: ids } }, data: { reversesId: null } });
    await tx.journalLine.deleteMany({ where: { entryId: { in: ids } } });
    await tx.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await tx.payment.deleteMany({ where: { expenseId: { in: bills.map((b) => b.id) } } });
    await tx.stockMovement.deleteMany({});
    await tx.goodsReceipt.deleteMany({});
    await tx.expense.deleteMany({ where: { id: { in: bills.map((b) => b.id) } } });
    await tx.purchaseOrder.deleteMany({});
    await tx.material.deleteMany({});
    await tx.auditLog.deleteMany({ where: { entity: { in: ["Material", "PurchaseOrder"] } } });
    await tx.sequence.deleteMany({ where: { key: { in: ["MAT", "PO", "GRN"] } } });
  });
  console.log(`removed ${ids.length} ledger entries, ${bills.length} bills, ${mats.length} materials and their orders and movements`);
}
main().finally(() => db.$disconnect());
