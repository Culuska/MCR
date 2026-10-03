import { D, round2, type Amount, type Money } from "@/lib/money";

// Rental cost rules, in one place.
//   The hire period counts both the first and the last day.
//   DAILY   = rate x days
//   WEEKLY  = rate x weeks, any part of a week counts as a full week
//   MONTHLY = rate x months of 30 days, any part of a month counts as a full month
//   Total   = hire + extra charges. The deposit is held by the supplier and is not a cost.

export type RateType = "DAILY" | "WEEKLY" | "MONTHLY";
const DAY = 86400000;

export const daysBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / DAY) + 1;

export function rentalPeriods(rateType: RateType, start: Date, end: Date): number {
  const days = daysBetween(start, end);
  if (days < 1) return 0;
  return rateType === "DAILY" ? days : rateType === "WEEKLY" ? Math.ceil(days / 7) : Math.ceil(days / 30);
}

export function rentalTotal(rateType: RateType, rate: Amount, start: Date, end: Date, extraCharges: Amount = 0): { periods: number; hire: Money; total: Money } {
  const periods = rentalPeriods(rateType, start, end);
  const hire = round2(D(rate).times(periods));
  return { periods, hire, total: hire.plus(D(extraCharges)) };
}

export const PERIOD_LABEL: Record<RateType, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };
