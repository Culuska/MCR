import { D, ZERO, round2, sum, type Amount, type Money } from "@/lib/money";

// Subcontract payment rules, in one place.
//   Revised value   = contract value + approved variations
//   A certificate states the value of work done TO DATE (cumulative), not just this period.
//   Gross (this certificate) = work to date - work certified before
//   Retention withheld       = gross x retention %, rounded to the cent
//   Net payable now          = gross - retention
//   Retention held           = retention withheld on approved or paid certificates - retention already released

export class SubcontractError extends Error {}

export const revisedValue = (contractValue: Amount, approvedVariations: Amount[]): Money => D(contractValue).plus(sum(approvedVariations));

export function certify(o: { revisedValue: Amount; retentionPct: Amount; previousToDate: Amount; workToDate: Amount }) {
  const revised = D(o.revisedValue), previous = D(o.previousToDate), toDate = D(o.workToDate);
  if (toDate.lessThanOrEqualTo(previous)) throw new SubcontractError(`The value of work to date must be more than the ${previous.toFixed(2)} already certified.`);
  if (toDate.greaterThan(revised)) throw new SubcontractError(`The value of work to date cannot be more than the contract value of ${revised.toFixed(2)}.`);
  const pct = D(o.retentionPct);
  if (pct.isNegative() || pct.greaterThan(100)) throw new SubcontractError("Retention must be between 0 and 100 percent.");
  const gross = toDate.minus(previous);
  const retention = round2(gross.times(pct).div(100));
  return { gross, retention, net: gross.minus(retention), percentComplete: revised.isZero() ? ZERO : toDate.div(revised).times(100) };
}

export const retentionHeld = (withheld: Amount[], released: Amount[]): Money => sum(withheld).minus(sum(released));

// Can the contract value be reduced (or a variation approved) without dropping below what is already certified?
export function checkRevision(newRevised: Amount, certifiedToDate: Amount) {
  if (D(newRevised).lessThan(D(certifiedToDate))) {
    throw new SubcontractError(`That would make the contract value ${D(newRevised).toFixed(2)}, which is less than the ${D(certifiedToDate).toFixed(2)} already certified.`);
  }
}

// Cumulative amount the programme expects to be certified by a date, and whether the subcontract is behind it.
export function behindSchedule(items: { amount: Amount; dueDate: Date }[], certifiedToDate: Amount, asOf: Date) {
  const planned = sum(items.filter((i) => i.dueDate <= asOf).map((i) => i.amount));
  const behind = planned.minus(D(certifiedToDate));
  return { planned, behind: behind.greaterThan(0) ? behind : ZERO };
}
