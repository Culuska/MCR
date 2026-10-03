import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { postEntry } from "../src/lib/ledger";
import { nextNumber } from "../src/lib/sequence";
import { CATEGORY_ACCOUNT, SYS } from "../src/lib/domain";
import { D } from "../src/lib/money";
import type { ExpenseCategory, Role } from "../src/generated/prisma/client";

// Sample data is marked "(sample)" so it is obvious what to delete before real use.
// Passwords come from .env (SEED_PASSWORD) so nothing secret lives in the repository.

const ACCOUNTS: [string, string, "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE", { cash?: boolean; system?: boolean }?][] = [
  ["1000", "Cash on Hand", "ASSET", { cash: true }],
  ["1010", "Bank - Main Account", "ASSET", { cash: true }],
  ["1020", "EVC Plus Wallet", "ASSET", { cash: true }],
  ["1100", "Accounts Receivable", "ASSET", { system: true }],
  ["1200", "Inventory", "ASSET"],
  ["1500", "Equipment", "ASSET"],
  ["1510", "Vehicles", "ASSET"],
  ["2000", "Accounts Payable", "LIABILITY", { system: true }],
  ["2100", "Loans", "LIABILITY"],
  ["2200", "Accrued Expenses", "LIABILITY"],
  ["3000", "Owner's Equity", "EQUITY"],
  ["4000", "Construction Revenue", "INCOME", { system: true }],
  ["4100", "Other Income", "INCOME"],
  ["5010", "Payroll and Wages", "EXPENSE"],
  ["5020", "Materials", "EXPENSE"],
  ["5030", "Fuel", "EXPENSE"],
  ["5040", "Equipment Rental", "EXPENSE"],
  ["5050", "Vehicle and Transport", "EXPENSE"],
  ["5060", "Equipment Maintenance", "EXPENSE"],
  ["5070", "Rent", "EXPENSE"],
  ["5080", "Subcontractors", "EXPENSE"],
  ["5090", "Utilities and Communication", "EXPENSE"],
  ["5100", "Insurance", "EXPENSE"],
  ["5110", "Permits and Fees", "EXPENSE"],
  ["5120", "Site Accommodation and Meals", "EXPENSE"],
  ["5130", "Tools", "EXPENSE"],
  ["5900", "Other Operating Expenses", "EXPENSE"],
];

const USERS: [string, string, Role][] = [
  ["admin@mcr.example", "System Admin", "SUPER_ADMIN"],
  ["finance@mcr.example", "Finance Manager", "FINANCE_MANAGER"],
  ["accountant@mcr.example", "Accountant", "ACCOUNTANT"],
  ["pm@mcr.example", "Project Manager", "PROJECT_MANAGER"],
  ["site@mcr.example", "Site Supervisor", "SITE_SUPERVISOR"],
  ["hr@mcr.example", "HR Officer", "HR"],
  ["store@mcr.example", "Storekeeper", "STOREKEEPER"],
  ["viewer@mcr.example", "Viewer", "VIEWER"],
];

const daysAgo = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const daysAhead = (n: number) => daysAgo(-n);

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_PASSWORD (10+ characters) in .env before seeding.");
  if ((await db.user.count()) > 0) { console.log("Database already has users. Seed skipped."); return; }

  const hash = await bcrypt.hash(password, 12);
  for (const [email, name, role] of USERS) await db.user.create({ data: { email, name, role, passwordHash: hash } });
  for (const [code, name, type, o] of ACCOUNTS) await db.account.create({ data: { code, name, type, isCash: !!o?.cash, isSystem: !!o?.system } });

  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@mcr.example" } });
  const pm = await db.user.findUniqueOrThrow({ where: { email: "pm@mcr.example" } });
  const acct = (code: string) => db.account.findUniqueOrThrow({ where: { code } });
  const bank = await acct("1010"), cash = await acct("1000");

  // Opening capital so the cash position starts positive.
  await db.$transaction(async (tx) => {
    await postEntry(tx, { date: daysAgo(150), description: "Opening capital", sourceType: "MANUAL", createdById: admin.id,
      lines: [{ accountCode: "1010", debit: 400000 }, { accountCode: "1000", debit: 20000 }, { accountCode: "3000", credit: 420000 }] });
  });

  const c1 = await db.customer.create({ data: { name: "Municipal Works Department (sample)", type: "Government", contact: "Sample Contact", phone: "+252 61 0000001" } });
  const c2 = await db.customer.create({ data: { name: "Relief Agency Housing Programme (sample)", type: "NGO / UN agency", contact: "Sample Contact", phone: "+252 61 0000002" } });
  const s1 = await db.supplier.create({ data: { name: "Sample Cement and Aggregates Supplier", contact: "Sample Contact", paymentTerms: "30 days" } });
  const s2 = await db.supplier.create({ data: { name: "Sample Steel and Hardware Traders", paymentTerms: "14 days" } });
  const s3 = await db.supplier.create({ data: { name: "Sample Plant Hire Ltd", paymentTerms: "On completion" } });

  const budgets = (m: Partial<Record<ExpenseCategory, number>>) => Object.entries(m).map(([category, amount]) => ({ category: category as ExpenseCategory, amount: D(amount!) }));
  const p1 = await db.project.create({ data: {
    code: "MCR-2026-01", name: "District Health Clinic Rehabilitation (sample)", customerId: c2.id, location: "Sample district", managerId: pm.id,
    contractValue: 250000, status: "ACTIVE", progress: 65, startDate: daysAgo(130), expectedEnd: daysAhead(60),
    budget: { create: budgets({ WAGES: 50000, MATERIALS: 90000, EQUIPMENT_RENTAL: 25000, FUEL: 12000, TRANSPORTATION: 10000, SUBCONTRACTORS: 30000, OTHER: 8000 }) } } });
  const p2 = await db.project.create({ data: {
    code: "MCR-2026-02", name: "Market Road and Drainage (sample)", customerId: c1.id, location: "Sample district", managerId: pm.id,
    contractValue: 500000, status: "ACTIVE", progress: 30, startDate: daysAgo(70), expectedEnd: daysAhead(170),
    budget: { create: budgets({ WAGES: 100000, MATERIALS: 180000, EQUIPMENT_RENTAL: 50000, FUEL: 25000, TRANSPORTATION: 20000, SUBCONTRACTORS: 60000, OTHER: 15000 }) } } });
  await db.project.create({ data: {
    code: "MCR-2026-03", name: "School Block Extension (sample)", customerId: c1.id, location: "Sample district", managerId: pm.id,
    contractValue: 180000, status: "PLANNING", progress: 0, startDate: daysAhead(30), expectedEnd: daysAhead(210),
    budget: { create: budgets({ WAGES: 35000, MATERIALS: 70000, EQUIPMENT_RENTAL: 12000, SUBCONTRACTORS: 25000 }) } } });

  // Expenses go through the same postings the app uses: Dr cost / Cr payables on approval, Dr payables / Cr cash on payment.
  async function expense(o: { age: number; project?: string; cat: ExpenseCategory; amount: number; desc: string; supplier?: string; pay?: "full" | "none" | number }) {
    await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, "EXP");
      const account = await tx.account.findUniqueOrThrow({ where: { code: CATEGORY_ACCOUNT[o.cat] } });
      const e = await tx.expense.create({ data: {
        number, date: daysAgo(o.age), projectId: o.project ?? null, category: o.cat, supplierId: o.supplier ?? null, description: o.desc,
        amount: D(o.amount), accountId: account.id, status: "APPROVED", createdById: pm.id, approvedById: admin.id, approvedAt: daysAgo(o.age),
        paymentMethod: "BANK_TRANSFER" } });
      await postEntry(tx, { date: e.date, description: `${number} ${o.desc}`, reference: number, sourceType: "EXPENSE", sourceId: e.id, createdById: admin.id,
        lines: [{ accountId: account.id, projectId: o.project, debit: o.amount }, { accountCode: SYS.AP, projectId: o.project, credit: o.amount }] });
      const paid = o.pay === "none" ? 0 : o.pay === undefined || o.pay === "full" ? o.amount : o.pay;
      if (paid > 0) {
        const pn = await nextNumber(tx, "PAY");
        const from = o.cat === "WAGES" ? cash : bank;
        const pay = await tx.payment.create({ data: { number: pn, kind: "DISBURSEMENT", date: daysAgo(o.age - 2 < 0 ? 0 : o.age - 2), amount: D(paid), method: o.cat === "WAGES" ? "CASH" : "BANK_TRANSFER", accountId: from.id, expenseId: e.id } });
        await postEntry(tx, { date: pay.date, description: `${pn} payment for ${number}`, reference: number, sourceType: "PAYMENT", sourceId: pay.id, createdById: admin.id,
          lines: [{ accountCode: SYS.AP, projectId: o.project, debit: paid }, { accountId: from.id, projectId: o.project, credit: paid }] });
        if (paid === o.amount) await tx.expense.update({ where: { id: e.id }, data: { status: "PAID", paidAt: pay.date } });
      }
    });
  }

  await expense({ age: 120, project: p1.id, cat: "MATERIALS", amount: 28500, desc: "Cement, 600 bags", supplier: s1.id });
  await expense({ age: 110, project: p1.id, cat: "WAGES", amount: 6200, desc: "Labour, first month" });
  await expense({ age: 95, project: p1.id, cat: "MATERIALS", amount: 21400, desc: "Rebar and binding wire", supplier: s2.id });
  await expense({ age: 80, project: p1.id, cat: "EQUIPMENT_RENTAL", amount: 9800, desc: "Excavator hire, 14 days", supplier: s3.id });
  await expense({ age: 62, project: p1.id, cat: "WAGES", amount: 7100, desc: "Labour, second month" });
  await expense({ age: 50, project: p1.id, cat: "SUBCONTRACTORS", amount: 18000, desc: "Electrical first fix" });
  await expense({ age: 40, project: p1.id, cat: "MATERIALS", amount: 24300, desc: "Blocks, sand and gravel", supplier: s1.id, pay: "none" });
  await expense({ age: 28, project: p1.id, cat: "FUEL", amount: 4600, desc: "Diesel for plant and trucks" });
  await expense({ age: 15, project: p1.id, cat: "WAGES", amount: 8400, desc: "Labour, fourth month" });
  await expense({ age: 55, project: p2.id, cat: "WAGES", amount: 9200, desc: "Labour, first month" });
  await expense({ age: 45, project: p2.id, cat: "EQUIPMENT_RENTAL", amount: 22500, desc: "Grader and roller hire", supplier: s3.id });
  await expense({ age: 36, project: p2.id, cat: "MATERIALS", amount: 61800, desc: "Aggregates and pipes", supplier: s1.id });
  await expense({ age: 24, project: p2.id, cat: "FUEL", amount: 11200, desc: "Diesel, plant and tippers" });
  await expense({ age: 18, project: p2.id, cat: "MATERIALS", amount: 34500, desc: "Culverts and kerbs", supplier: s2.id, pay: 12000 });
  await expense({ age: 8, project: p2.id, cat: "WAGES", amount: 10400, desc: "Labour, second month" });
  await expense({ age: 100, cat: "OFFICE_RENT", amount: 1500, desc: "Office rent" });
  await expense({ age: 70, cat: "OFFICE_RENT", amount: 1500, desc: "Office rent" });
  await expense({ age: 40, cat: "OFFICE_RENT", amount: 1500, desc: "Office rent" });
  await expense({ age: 10, cat: "UTILITIES", amount: 640, desc: "Electricity and internet" });

  // A submitted expense waiting for approval, and a draft.
  await db.$transaction(async (tx) => {
    const acc = await tx.account.findUniqueOrThrow({ where: { code: CATEGORY_ACCOUNT.TRANSPORTATION } });
    await tx.expense.create({ data: { number: await nextNumber(tx, "EXP"), date: daysAgo(3), projectId: p2.id, category: "TRANSPORTATION", description: "Tipper hire for spoil removal", amount: D(3200), accountId: acc.id, status: "SUBMITTED", createdById: pm.id } });
    await tx.expense.create({ data: { number: await nextNumber(tx, "EXP"), date: daysAgo(1), projectId: p1.id, category: "TOOLS", description: "Hand tools and PPE", amount: D(850), accountId: (await tx.account.findUniqueOrThrow({ where: { code: "5130" } })).id, status: "DRAFT", createdById: pm.id } });
  });

  async function invoice(o: { project: string; customer: string; amount: number; age: number; due: number; paid?: number }) {
    await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, "INV");
      const inv = await tx.invoice.create({ data: { number, customerId: o.customer, projectId: o.project, issueDate: daysAgo(o.age), dueDate: daysAgo(o.age - o.due), amount: D(o.amount), status: "SENT" } });
      await postEntry(tx, { date: inv.issueDate, description: `${number} invoice`, reference: number, sourceType: "INVOICE", sourceId: inv.id, createdById: admin.id,
        lines: [{ accountCode: SYS.AR, projectId: o.project, debit: o.amount }, { accountCode: SYS.REVENUE, projectId: o.project, credit: o.amount }] });
      if (o.paid) {
        const rn = await nextNumber(tx, "REC");
        const pay = await tx.payment.create({ data: { number: rn, kind: "RECEIPT", date: daysAgo(Math.max(o.age - o.due + 5, 0)), amount: D(o.paid), method: "BANK_TRANSFER", accountId: bank.id, invoiceId: inv.id } });
        await postEntry(tx, { date: pay.date, description: `${rn} received for ${number}`, reference: number, sourceType: "PAYMENT", sourceId: pay.id, createdById: admin.id,
          lines: [{ accountId: bank.id, projectId: o.project, debit: o.paid }, { accountCode: SYS.AR, projectId: o.project, credit: o.paid }] });
        await tx.invoice.update({ where: { id: inv.id }, data: { status: o.paid === o.amount ? "PAID" : "PARTIAL" } });
      }
    });
  }

  await invoice({ project: p1.id, customer: c2.id, amount: 75000, age: 118, due: 30, paid: 75000 });
  await invoice({ project: p1.id, customer: c2.id, amount: 80000, age: 60, due: 30, paid: 80000 });
  await invoice({ project: p1.id, customer: c2.id, amount: 30000, age: 20, due: 14 });
  await invoice({ project: p2.id, customer: c1.id, amount: 100000, age: 55, due: 30, paid: 60000 });
  await invoice({ project: p2.id, customer: c1.id, amount: 45000, age: 10, due: 30 });

  console.log(`Seeded ${USERS.length} users, ${ACCOUNTS.length} accounts and sample projects. Sign-in details are in .env (SEED_PASSWORD).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
