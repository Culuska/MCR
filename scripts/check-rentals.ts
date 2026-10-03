import { rentalPeriods, rentalTotal } from "../src/lib/rentals";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const d = (s: string) => new Date(s);

eq("one day hire counts the day itself", rentalPeriods("DAILY", d("2026-09-01"), d("2026-09-01")), 1);
eq("daily: 1st to 10th is 10 days", rentalPeriods("DAILY", d("2026-09-01"), d("2026-09-10")), 10);
eq("weekly: 7 days is 1 week", rentalPeriods("WEEKLY", d("2026-09-01"), d("2026-09-07")), 1);
eq("weekly: 8 days is 2 weeks", rentalPeriods("WEEKLY", d("2026-09-01"), d("2026-09-08")), 2);
eq("monthly: 30 days is 1 month", rentalPeriods("MONTHLY", d("2026-09-01"), d("2026-09-30")), 1);
eq("monthly: 31 days is 2 months", rentalPeriods("MONTHLY", d("2026-08-01"), d("2026-08-31")), 2);
eq("end before start is zero", rentalPeriods("DAILY", d("2026-09-10"), d("2026-09-01")), 0);

const t = rentalTotal("DAILY", 120, d("2026-09-01"), d("2026-09-10"), 75.5);
eq("excavator 10 days at $120 + $75.50 extras", t.total, 1275.5);
eq("hire part", t.hire, 1200);
eq("weekly total", rentalTotal("WEEKLY", 700, d("2026-09-01"), d("2026-09-15")).total, 2100);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
