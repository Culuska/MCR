import { afterAdjustment, afterIssue, afterReceipt, afterReversedReceipt, isLow, valueAt } from "../src/lib/stock";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const throws = (name: string, fn: () => unknown, text: string) => {
  try { fn(); failed++; console.log("FAIL", name, "did not throw"); }
  catch (e) { const ok = String((e as Error).message).includes(text); if (!ok) failed++; console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got "${(e as Error).message}"`); }
};

// Cement: 100 bags at $8, then 100 bags at $10 -> average $9.
let s = afterReceipt({ onHand: 0, avgCost: 0 }, 100, 8);
eq("first receipt sets the cost", s.avgCost, 8);
s = afterReceipt(s, 100, 10);
eq("second receipt blends to the average", s.avgCost, 9);
eq("quantity adds up", s.onHand, 200);

// Issuing uses the average and does not change it.
eq("issue is valued at the average cost", valueAt(30, s.avgCost), 270);
const out = afterIssue(s, 30);
eq("quantity falls", out.onHand, 170);
eq("average cost stays put", out.avgCost, 9);
throws("cannot issue more than is on hand", () => afterIssue(out, 171), "Not enough stock");
throws("cannot issue zero", () => afterIssue(out, 0), "more than zero");

// A later receipt blends with what is left, not with what was bought.
const later = afterReceipt(out, 30, 12);
eq("blend after an issue: (170 x 9 + 30 x 12) / 200", later.avgCost, 9.45);

// Fractions: 2.5 tonnes of sand at $14.40 a tonne.
eq("fractional quantity valued to the cent", valueAt(2.5, 14.4), 36);
eq("cost that does not divide evenly rounds to four places", afterReceipt({ onHand: 3, avgCost: 10 }, 4, 11).avgCost, "10.5714");

// Reversing a receipt.
const rev = afterReversedReceipt(later, 30, 12);
eq("reversal restores the quantity", rev.onHand, 170);
eq("reversal restores the average cost", rev.avgCost, 9);
throws("cannot reverse a receipt whose stock was used", () => afterReversedReceipt({ onHand: 10, avgCost: 9 }, 30, 12), "already been used");
eq("reversing everything leaves zero", afterReversedReceipt({ onHand: 30, avgCost: 12 }, 30, 12).onHand, 0);

// Stock count corrections.
eq("write-off lowers the quantity", afterAdjustment(out, -5).onHand, 165);
throws("cannot write off more than is held", () => afterAdjustment(out, -171), "below zero");
throws("zero adjustment is refused", () => afterAdjustment(out, 0), "cannot be zero");

// Reorder alert.
eq("low when at or under the reorder level", isLow(50, 50), true);
eq("not low when above it", isLow(51, 50), false);
eq("no alert when no reorder level is set", isLow(0, 0), false);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
