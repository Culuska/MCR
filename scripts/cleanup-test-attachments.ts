import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

// Removes attachments and their stored files after a test run.
// It deletes EVERY attachment, including any real receipts, so it refuses to run unless you pass --all.
// Real attachments are never deleted in the app: they are hidden with a reason.
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run in production.");
  const rows = await db.attachment.findMany({ select: { id: true, storageKey: true, filename: true, uploadedById: true, createdAt: true } });
  if (!process.argv.includes("--all")) {
    console.log(`There are ${rows.length} attachments. This script deletes all of them and their files. Run again with --all to confirm.`);
    return;
  }
  const root = path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"));
  let files = 0;
  for (const r of rows) {
    const target = path.resolve(root, r.storageKey);
    if (!target.startsWith(root + path.sep)) continue; // never touch anything outside the storage folder
    await rm(target, { force: true });
    files++;
  }
  await db.attachment.deleteMany({});
  const audit = await db.auditLog.deleteMany({ where: { action: { in: ["attachment.add", "attachment.remove"] } } });
  console.log(`removed ${rows.length} attachments, ${files} files and ${audit.count} history lines`);
}
main().finally(() => db.$disconnect());
