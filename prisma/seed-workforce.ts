import "dotenv/config";
import { db } from "../src/lib/db";
import { nextNumber } from "../src/lib/sequence";
import type { AttendanceStatus, PayType } from "../src/generated/prisma/client";

// Phase 2 seed. Safe to run more than once: it adds the payroll accounts if missing and
// only creates sample staff when there are no employees yet.

const ACCOUNTS: [string, string, "ASSET" | "LIABILITY"][] = [
  ["1300", "Employee Advances", "ASSET"],
  ["2300", "Wages Payable", "LIABILITY"],
  ["2310", "Payroll Deductions Payable", "LIABILITY"],
];

// [name, position, payType, rate, overtime per hour, team]
const STAFF: [string, string, PayType, number, number, "p1" | "p2" | "split" | "office"][] = [
  ["Site Foreman (sample)", "Site foreman", "MONTHLY", 700, 0, "p1"],
  ["Site Engineer (sample)", "Site engineer", "MONTHLY", 900, 0, "p2"],
  ["Storekeeper (sample)", "Storekeeper", "MONTHLY", 450, 0, "office"],
  ["Mason 1 (sample)", "Mason", "DAILY", 25, 4, "p1"],
  ["Mason 2 (sample)", "Mason", "DAILY", 25, 4, "p1"],
  ["Mason 3 (sample)", "Mason", "DAILY", 25, 4, "split"],
  ["Mason 4 (sample)", "Mason", "DAILY", 25, 4, "p2"],
  ["Labourer 1 (sample)", "Labourer", "DAILY", 15, 2.5, "p1"],
  ["Labourer 2 (sample)", "Labourer", "DAILY", 15, 2.5, "p1"],
  ["Labourer 3 (sample)", "Labourer", "DAILY", 15, 2.5, "p2"],
  ["Labourer 4 (sample)", "Labourer", "DAILY", 15, 2.5, "p2"],
  ["Plant Operator (sample)", "Plant operator", "DAILY", 30, 5, "p2"],
  ["Truck Driver (sample)", "Driver", "DAILY", 20, 3, "p2"],
];

// A small repeatable pseudo-random generator so the sample data is the same every time.
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }

async function main() {
  for (const [code, name, type] of ACCOUNTS) {
    await db.account.upsert({ where: { code }, create: { code, name, type, isSystem: true }, update: {} });
  }
  if ((await db.employee.count()) > 0) { console.log("Employees already exist. Sample staff skipped."); return; }

  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const p1 = await db.project.findUnique({ where: { code: "MCR-2026-01" } });
  const p2 = await db.project.findUnique({ where: { code: "MCR-2026-02" } });
  const rand = rng(42);

  const employees = [];
  for (const [name, position, payType, rate, overtimeRate] of STAFF) {
    const code = await db.$transaction(async (tx) => (await nextNumber(tx, "EMP")).replace("EMP-0", "EMP-"));
    employees.push(await db.employee.create({ data: { code, name, position, payType, rate, overtimeRate, department: position === "Storekeeper" ? "Stores" : "Site", paymentDetails: "EVC Plus (sample number)" } }));
  }

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  let rows = 0;
  for (let back = 40; back >= 1; back--) {
    const day = new Date(today); day.setUTCDate(day.getUTCDate() - back);
    if (day.getUTCDay() === 5) continue; // Friday is the weekly rest day
    for (const [i, e] of employees.entries()) {
      const team = STAFF[i][5];
      const projectId = team === "office" ? null : team === "p1" ? p1?.id : team === "p2" ? p2?.id : back > 20 ? p1?.id : p2?.id;
      const roll = rand();
      const status: AttendanceStatus = roll < 0.82 ? "PRESENT" : roll < 0.9 ? "HALF_DAY" : roll < 0.96 ? "ABSENT" : "LEAVE";
      const overtimeHours = (status === "PRESENT" || status === "HALF_DAY") && e.overtimeRate.toNumber() > 0 && rand() < 0.18 ? Math.ceil(rand() * 3) : 0;
      await db.attendance.create({ data: { employeeId: e.id, date: day, projectId: projectId ?? null, status, overtimeHours, recordedById: admin.id } });
      rows++;
    }
  }
  console.log(`Added ${employees.length} sample employees and ${rows} attendance records. Payroll accounts are ready.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
