import { computePay, type PayDay } from "../src/lib/payroll";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const days = (n: number, projectId: string | null, status: PayDay["status"] = "PRESENT", ot = 0): PayDay[] =>
  Array.from({ length: n }, () => ({ status, overtimeHours: ot, projectId }));

// The example from the spec: $20 a day, 24 days, $50 overtime -> $530.
const spec = computePay({ payType: "DAILY", rate: 20, overtimeRate: 5 }, [...days(23, "A"), { status: "PRESENT", overtimeHours: 10, projectId: "A" }], 30);
eq("spec example gross", spec.gross, 530);
eq("spec example paid days", spec.paidDays, 24);

// Half days and absences.
const mixed = computePay({ payType: "DAILY", rate: 20, overtimeRate: 0 }, [...days(10, "A"), ...days(2, "A", "HALF_DAY"), ...days(3, "A", "ABSENT"), ...days(2, "A", "LEAVE")], 30);
eq("daily: 10 present + 2 half = 11 days", mixed.paidDays, 11);
eq("daily: leave and absent unpaid", mixed.basePay, 220);

// Monthly salary pro-rated: 13 days of 26 is half.
const half = computePay({ payType: "MONTHLY", rate: 600, overtimeRate: 0 }, days(13, "A"), 30);
eq("monthly half month", half.basePay, 300);
const leave = computePay({ payType: "MONTHLY", rate: 600, overtimeRate: 0 }, [...days(24, "A"), ...days(2, "A", "LEAVE")], 30);
eq("monthly: paid leave counts, full month", leave.basePay, 600);
const over = computePay({ payType: "MONTHLY", rate: 600, overtimeRate: 0 }, days(30, "A"), 30);
eq("monthly: capped at one full salary", over.basePay, 600);

// Deductions and advances.
const net = computePay({ payType: "DAILY", rate: 20, overtimeRate: 0 }, days(20, "A"), 30, { bonus: 30, deductions: 10, advanceRecovered: 50 });
eq("gross with bonus", net.gross, 430);
eq("net after deductions and advance", net.net, 370);

// Cost is split by where the person worked, with no cent lost.
const split = computePay({ payType: "DAILY", rate: 33.33, overtimeRate: 0 }, [...days(3, "A"), ...days(1, "B"), ...days(1, null)], 30);
const total = split.allocations.reduce((a, x) => a.plus(x.amount), split.gross.minus(split.gross));
eq("allocations add up to gross", total, split.gross);
eq("allocated to 3 buckets", split.allocations.length, 3);

// Overtime is charged to the project where it was worked.
const ot = computePay({ payType: "DAILY", rate: 20, overtimeRate: 4 }, [{ status: "PRESENT", overtimeHours: 5, projectId: "A" }, { status: "PRESENT", overtimeHours: 0, projectId: "B" }], 30);
eq("A gets 20 base + 20 overtime", ot.allocations.find((a) => a.projectId === "A")?.amount, 40);
eq("B gets 20 base", ot.allocations.find((a) => a.projectId === "B")?.amount, 20);

// Overtime on an absent day is ignored.
const abs = computePay({ payType: "DAILY", rate: 20, overtimeRate: 4 }, [{ status: "ABSENT", overtimeHours: 8, projectId: "A" }], 30);
eq("no overtime when absent", abs.gross, 0);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
