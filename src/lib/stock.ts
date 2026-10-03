import { D, ZERO, round2, type Amount, type Money } from "@/lib/money";

// Stock cost rules, in one place.
//   Weighted-average cost: every receipt blends its price into the average cost of what is on hand.
//   An issue is valued at the average cost at that moment, so the project is charged the blended price.
//   Quantities are held to three decimals and unit costs to four, so a bag, a tonne and a litre all fit.

export type StockState = { onHand: Money; avgCost: Money };

const q3 = (v: Money) => v.toDecimalPlaces(3, 4);
const c4 = (v: Money) => v.toDecimalPlaces(4, 4);

export function afterReceipt(state: { onHand: Amount; avgCost: Amount }, qty: Amount, unitCost: Amount): StockState {
  const onHand = D(state.onHand), add = D(qty);
  const newQty = onHand.plus(add);
  if (add.lessThanOrEqualTo(0)) throw new Error("Received quantity must be more than zero.");
  const value = onHand.times(D(state.avgCost)).plus(add.times(D(unitCost)));
  return { onHand: q3(newQty), avgCost: newQty.isZero() ? D(state.avgCost) : c4(value.div(newQty)) };
}

// Value of an issue or write-off at the current average cost, to the cent.
export const valueAt = (qty: Amount, avgCost: Amount): Money => round2(D(qty).abs().times(D(avgCost)));

export function afterIssue(state: { onHand: Amount; avgCost: Amount }, qty: Amount): StockState {
  const out = D(qty);
  if (out.lessThanOrEqualTo(0)) throw new Error("Quantity must be more than zero.");
  if (out.greaterThan(D(state.onHand))) throw new Error("Not enough stock.");
  return { onHand: q3(D(state.onHand).minus(out)), avgCost: D(state.avgCost) }; // average cost does not move on the way out
}

// Takes a receipt back out. Refuses if some of that stock has already been used.
export function afterReversedReceipt(state: { onHand: Amount; avgCost: Amount }, qty: Amount, unitCost: Amount): StockState {
  const back = D(qty), onHand = D(state.onHand);
  if (back.greaterThan(onHand)) throw new Error("Some of this stock has already been used.");
  const left = onHand.minus(back);
  if (left.isZero()) return { onHand: ZERO, avgCost: D(state.avgCost) };
  const value = onHand.times(D(state.avgCost)).minus(back.times(D(unitCost)));
  return { onHand: q3(left), avgCost: c4(value.isNegative() ? ZERO : value.div(left)) };
}

// Stock count correction: positive adds at the current average cost, negative writes off.
export function afterAdjustment(state: { onHand: Amount; avgCost: Amount }, delta: Amount): StockState {
  const d = D(delta), onHand = D(state.onHand);
  if (d.isZero()) throw new Error("The adjustment cannot be zero.");
  if (onHand.plus(d).isNegative()) throw new Error("That would take stock below zero.");
  return { onHand: q3(onHand.plus(d)), avgCost: D(state.avgCost) };
}

export const isLow = (onHand: Amount, reorderLevel: Amount) => D(reorderLevel).greaterThan(0) && D(onHand).lessThanOrEqualTo(D(reorderLevel));
