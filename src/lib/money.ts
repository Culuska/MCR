import { Prisma } from "@/generated/prisma/client";

export type Money = Prisma.Decimal;
export type Amount = Prisma.Decimal | string | number;
export const D = (v: Amount | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = new Prisma.Decimal(0);

export function sum(values: Array<Amount | null | undefined>): Money {
  return values.reduce<Money>((a, v) => a.plus(D(v)), ZERO);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const fmt = (v: Amount | null | undefined) => usd.format(D(v).toNumber());
export const fmt2 = (v: Amount | null | undefined) => usd2.format(D(v).toNumber());

export function pct(part: Amount, whole: Amount): number {
  const w = D(whole);
  return w.isZero() ? 0 : D(part).div(w).times(100).toNumber();
}

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const toDateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export const round2 = (v: Money) => v.toDecimalPlaces(2, 4); // 4 = round half up

// Whole days from now until a date. Negative once the date has passed.
export const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86400000);
