import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

// Test data for scripts/test_scope.py: two projects (ZZ-A and ZZ-B), people limited to one of them, and a record of each
// kind on each project. Everything is named ZZ so it can never be mistaken for real data, and cleanup removes only that.
//   setup   creates it and prints the ids as JSON
//   cleanup removes it

const EMAILS = ["zz-pm@mcr.example", "zz-site@mcr.example", "zz-view@mcr.example"];
const day = new Date();

async function main() {
  const mode = process.argv[2];
  if (mode === "setup") {
    await cleanup();
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@mcr.example" } });
    const account = await db.account.findUniqueOrThrow({ where: { code: "5900" } });
    const hash = await bcrypt.hash("Not-Used-For-Login-1!", 10);
    const pm = await db.user.create({ data: { email: EMAILS[0], name: "ZZ Scope PM", role: "PROJECT_MANAGER", passwordHash: hash } });
    const site = await db.user.create({ data: { email: EMAILS[1], name: "ZZ Scope Site", role: "SITE_SUPERVISOR", passwordHash: hash } });
    const view = await db.user.create({ data: { email: EMAILS[2], name: "ZZ Scope Viewer", role: "VIEWER", projectScope: "ASSIGNED", passwordHash: hash } });
    const customer = await db.customer.create({ data: { name: "ZZ Scope Customer" } });
    const supplier = await db.supplier.create({ data: { name: "ZZ Scope Supplier" } });

    const ids: Record<string, string> = { pm: pm.id, site: site.id, view: view.id, admin: admin.id };
    for (const k of ["A", "B"] as const) {
      const p = await db.project.create({ data: { code: `ZZ-${k}`, name: `ZZ Scope project ${k}`, status: "ACTIVE", customerId: customer.id, contractValue: 1000 } });
      ids[`p${k}`] = p.id;
      ids[`exp${k}`] = (await db.expense.create({ data: { number: `EXP-ZZ${k}1`, date: day, category: "OTHER", description: `ZZ scope expense ${k}`, amount: 10, accountId: account.id, projectId: p.id, createdById: admin.id, status: "DRAFT" } })).id;
      ids[`task${k}`] = (await db.task.create({ data: { number: `TSK-ZZ${k}`, projectId: p.id, title: `ZZ scope task ${k}`, dueDate: new Date(day.getTime() + 86400000 * 10), createdById: admin.id } })).id;
      ids[`inv${k}`] = (await db.invoice.create({ data: { number: `INV-ZZ${k}`, customerId: customer.id, projectId: p.id, issueDate: day, dueDate: day, amount: 50, status: "DRAFT" } })).id;
      ids[`sub${k}`] = (await db.subcontract.create({ data: { number: `SUB-ZZ${k}`, supplierId: supplier.id, projectId: p.id, scope: `ZZ scope works ${k}`, contractValue: 500, createdById: admin.id } })).id;
      ids[`po${k}`] = (await db.purchaseOrder.create({ data: { number: `PO-ZZ${k}`, supplierId: supplier.id, projectId: p.id, orderDate: day, createdById: admin.id } })).id;
      ids[`rep${k}`] = (await db.siteReport.create({ data: { projectId: p.id, date: new Date(day.getTime() - 86400000 * (k === "A" ? 1 : 2)), workDone: `ZZ scope report ${k}`, createdById: admin.id } })).id;
      // a small PDF attached to the expense on each project
      const now = new Date();
      const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
      const file = path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"), key);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
      ids[`att${k}`] = (await db.attachment.create({ data: { entity: "Expense", entityId: ids[`exp${k}`], filename: `zz-${k}.pdf`, mime: "application/pdf", size: 60, sha256: `zz${k}`.padEnd(64, "0"), storageKey: key, uploadedById: admin.id } })).id;
    }
    await db.projectAccess.createMany({ data: [{ userId: pm.id, projectId: ids.pA }, { userId: site.id, projectId: ids.pA }, { userId: view.id, projectId: ids.pB }] });
    console.log(JSON.stringify(ids));
  } else if (mode === "state") {
    const one = async (n: string) => (await db.expense.findUnique({ where: { number: n }, select: { status: true } }))?.status ?? "gone";
    console.log(JSON.stringify({ expB: await one("EXP-ZZB1"), expA: await one("EXP-ZZA1"), taskB: (await db.task.findUnique({ where: { number: "TSK-ZZB" }, select: { status: true } }))?.status ?? "gone" }));
  } else if (mode === "cleanup") {
    await cleanup();
    console.log("cleaned");
  } else console.log("use: setup | cleanup");
}

async function cleanup() {
  const projects = await db.project.findMany({ where: { code: { in: ["ZZ-A", "ZZ-B"] } }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  const users = await db.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const files = await db.attachment.findMany({ where: { filename: { startsWith: "zz-" } }, select: { storageKey: true } });
  for (const f of files) rmSync(path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"), f.storageKey), { force: true });
  await db.attachment.deleteMany({ where: { filename: { startsWith: "zz-" } } });
  await db.siteReport.deleteMany({ where: { projectId: { in: pids } } });
  await db.subcontract.deleteMany({ where: { projectId: { in: pids } } });
  await db.purchaseOrder.deleteMany({ where: { number: { in: ["PO-ZZA", "PO-ZZB"] } } });
  await db.invoice.deleteMany({ where: { number: { in: ["INV-ZZA", "INV-ZZB"] } } });
  await db.task.deleteMany({ where: { projectId: { in: pids } } });
  await db.expense.deleteMany({ where: { number: { in: ["EXP-ZZA1", "EXP-ZZB1"] } } });
  await db.expense.deleteMany({ where: { description: { startsWith: "ZZ scope" } } });
  await db.projectAccess.deleteMany({ where: { OR: [{ userId: { in: uids } }, { projectId: { in: pids } }] } });
  await db.project.deleteMany({ where: { id: { in: pids } } });
  await db.customer.deleteMany({ where: { name: "ZZ Scope Customer" } });
  await db.supplier.deleteMany({ where: { name: "ZZ Scope Supplier" } });
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: uids } }, { entityId: { in: uids } }, { summary: { contains: "ZZ" } }] } });
  await db.loginAttempt.deleteMany({ where: { email: { in: EMAILS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}
main().finally(() => db.$disconnect());
