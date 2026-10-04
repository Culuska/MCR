import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

// First-time setup for a real (empty) database: the chart of accounts and one Super Admin. No sample records.
// Needs ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (12+ characters) in the environment. Safe to run twice.

type T = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
const ACCOUNTS: [string, string, T, { cash?: boolean; system?: boolean }?][] = [
  ["1000", "Cash on Hand", "ASSET", { cash: true }], ["1010", "Bank - Main Account", "ASSET", { cash: true }], ["1020", "EVC Plus Wallet", "ASSET", { cash: true }],
  ["1100", "Accounts Receivable", "ASSET", { system: true }], ["1200", "Inventory", "ASSET"], ["1300", "Employee Advances", "ASSET", { system: true }],
  ["1500", "Equipment", "ASSET"], ["1510", "Vehicles", "ASSET"],
  ["2000", "Accounts Payable", "LIABILITY", { system: true }], ["2100", "Loans", "LIABILITY"], ["2200", "Accrued Expenses", "LIABILITY"],
  ["2300", "Wages Payable", "LIABILITY", { system: true }], ["2310", "Payroll Deductions Payable", "LIABILITY", { system: true }], ["2320", "Retention Payable", "LIABILITY", { system: true }],
  ["3000", "Owner's Equity", "EQUITY"], ["4000", "Construction Revenue", "INCOME", { system: true }], ["4100", "Other Income", "INCOME"],
  ["5010", "Payroll and Wages", "EXPENSE"], ["5020", "Materials", "EXPENSE"], ["5030", "Fuel", "EXPENSE"], ["5040", "Equipment Rental", "EXPENSE"],
  ["5050", "Vehicle and Transport", "EXPENSE"], ["5060", "Equipment Maintenance", "EXPENSE"], ["5070", "Rent", "EXPENSE"], ["5080", "Subcontractors", "EXPENSE"],
  ["5090", "Utilities and Communication", "EXPENSE"], ["5100", "Insurance", "EXPENSE"], ["5110", "Permits and Fees", "EXPENSE"],
  ["5120", "Site Accommodation and Meals", "EXPENSE"], ["5130", "Tools", "EXPENSE"], ["5900", "Other Operating Expenses", "EXPENSE"],
];

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(), name = process.env.ADMIN_NAME?.trim(), password = process.env.ADMIN_PASSWORD;
  if (!email || !name || !password || password.length < 12) throw new Error("Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (12+ characters).");
  for (const [code, n, type, o] of ACCOUNTS)
    await db.account.upsert({ where: { code }, create: { code, name: n, type, isCash: !!o?.cash, isSystem: !!o?.system }, update: {} });
  if (await db.user.findUnique({ where: { email } })) { console.log("That admin already exists. Nothing changed."); return; }
  await db.user.create({ data: { email, name, role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password, 12) } });
  console.log(`Ready: ${ACCOUNTS.length} accounts and admin ${email}.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
