import "dotenv/config";
import { db } from "../src/lib/db";

// Test data for the Delete buttons. Everything is named "ZZ Delete ..." so it can never be mistaken for real data.
//   npx tsx scripts/test-delete-data.ts setup    creates the test records
//   npx tsx scripts/test-delete-data.ts check    says which of them still exist
//   npx tsx scripts/test-delete-data.ts cleanup  removes whatever is left of them (only records with these exact names)

const CUSTOMERS = ["ZZ Delete Customer Free", "ZZ Delete Customer Used"];
const SUPPLIERS = ["ZZ Delete Supplier Free"];
const PROJECT = "ZZ-DEL";
const INVOICES = ["INV-ZZDEL1", "INV-ZZDEL2"]; // 1 = draft, 2 = issued
const EXPENSES = ["EXP-ZZDEL1", "EXP-ZZDEL2"]; // 1 = draft, 2 = approved

async function main() {
  const mode = process.argv[2];
  if (mode === "setup") {
    const finance = await db.user.findUniqueOrThrow({ where: { email: "finance@mcr.example" } });
    const account = await db.account.findUniqueOrThrow({ where: { code: "5900" } });
    await db.customer.create({ data: { name: CUSTOMERS[0] } });
    const used = await db.customer.create({ data: { name: CUSTOMERS[1] } });
    await db.supplier.create({ data: { name: SUPPLIERS[0] } });
    const project = await db.project.create({ data: { code: PROJECT, name: "ZZ Delete project", customerId: used.id } });
    const day = new Date();
    for (const [i, number] of INVOICES.entries())
      await db.invoice.create({ data: { number, customerId: used.id, projectId: project.id, issueDate: day, dueDate: day, amount: 100, status: i === 0 ? "DRAFT" : "SENT" } });
    for (const [i, number] of EXPENSES.entries())
      await db.expense.create({ data: { number, date: day, category: "OTHER", description: "ZZ Delete test", amount: 10, accountId: account.id, status: i === 0 ? "DRAFT" : "APPROVED", createdById: finance.id } });
    console.log("created test records");
  } else if (mode === "check") {
    console.log(JSON.stringify({
      customers: (await db.customer.findMany({ where: { name: { in: CUSTOMERS } }, select: { name: true } })).map((c) => c.name),
      suppliers: (await db.supplier.findMany({ where: { name: { in: SUPPLIERS } }, select: { name: true } })).map((c) => c.name),
      project: !!(await db.project.findUnique({ where: { code: PROJECT } })),
      invoices: (await db.invoice.findMany({ where: { number: { in: INVOICES } }, select: { number: true } })).map((c) => c.number),
      expenses: (await db.expense.findMany({ where: { number: { in: EXPENSES } }, select: { number: true } })).map((c) => c.number),
      audit: (await db.auditLog.findMany({ where: { action: { endsWith: ".delete" } }, orderBy: { createdAt: "desc" }, take: 8, select: { summary: true } })).map((a) => a.summary),
    }, null, 1));
  } else if (mode === "cleanup") {
    await db.expense.deleteMany({ where: { number: { in: EXPENSES } } });
    await db.invoice.deleteMany({ where: { number: { in: INVOICES } } });
    await db.project.deleteMany({ where: { code: PROJECT } });
    await db.customer.deleteMany({ where: { name: { in: CUSTOMERS } } });
    await db.supplier.deleteMany({ where: { name: { in: SUPPLIERS } } });
    await db.auditLog.deleteMany({ where: { action: { endsWith: ".delete" }, summary: { contains: "ZZ" } } });
    console.log("test records removed");
  } else console.log("use: setup | check | cleanup");
}
main().finally(() => db.$disconnect());
