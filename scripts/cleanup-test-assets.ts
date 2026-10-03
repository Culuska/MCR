import "dotenv/config";
import { db } from "../src/lib/db";

// Removes the records that scripts/test_assets.py creates. Touches only unposted test data:
// usage entries with the 99,990 test reading, the test hire, test maintenance, and their DRAFT expenses.
async function main() {
  const usage = await db.assetUsage.findMany({ where: { startReading: { gte: 99000 } } });
  const since = usage.length ? new Date(Math.min(...usage.map((u) => u.createdAt.getTime())) - 10 * 60000) : new Date(Date.now() - 60 * 60000);

  // The test signs in as the Project Manager; the seed data was created by the admin, so this never touches it.
  const pm = await db.user.findUniqueOrThrow({ where: { email: "pm@mcr.example" } });
  const rentals = await db.rental.findMany({ where: { createdById: pm.id }, include: { expense: true } });
  const maint = await db.maintenanceRecord.findMany({ where: { createdById: pm.id }, include: { expense: true } });
  const drafts = [...rentals.map((r) => r.expense), ...maint.map((m) => m.expense)].filter((e): e is NonNullable<typeof e> => !!e);
  const posted = drafts.filter((e) => e.status !== "DRAFT");
  if (posted.length) throw new Error(`Refusing to delete: ${posted.map((e) => e.number).join(", ")} is no longer a draft.`);

  const del = { usage: (await db.assetUsage.deleteMany({ where: { id: { in: usage.map((u) => u.id) } } })).count, rentals: 0, maint: 0, expenses: 0, audit: 0 };
  for (const r of rentals) { await db.rental.delete({ where: { id: r.id } }); del.rentals++; }
  for (const m of maint) { await db.maintenanceRecord.delete({ where: { id: m.id } }); del.maint++; }
  for (const e of drafts) { await db.expense.delete({ where: { id: e.id } }); del.expenses++; }
  // Also remove the audit lines the test actions wrote, so the trail does not describe records that no longer exist.
  del.audit = (await db.auditLog.deleteMany({ where: { userId: pm.id, createdAt: { gte: since }, action: { in: ["asset.usage", "rental.create", "rental.expense", "asset.maintenance", "asset.assign"] } } })).count;
  console.log("removed", del);
}
main().finally(() => db.$disconnect());
