import { behindSchedule, certify, checkRevision, retentionHeld, revisedValue } from "../src/lib/subcontract";

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

// $50,000 contract, 5% retention.
const first = certify({ revisedValue: 50000, retentionPct: 5, previousToDate: 0, workToDate: 20000 });
eq("first certificate: gross is the work to date", first.gross, 20000);
eq("retention is 5% of the gross", first.retention, 1000);
eq("net payable is gross less retention", first.net, 19000);
eq("percent complete", first.percentComplete.toFixed(1), "40.0");

// The next certificate states the total to date; only the new part is paid.
const second = certify({ revisedValue: 50000, retentionPct: 5, previousToDate: 20000, workToDate: 35000 });
eq("second certificate pays only the new work", second.gross, 15000);
eq("retention on the new work", second.retention, 750);
eq("net", second.net, 14250);

// Rounding to the cent and no cent lost.
const odd = certify({ revisedValue: 10000, retentionPct: 7.5, previousToDate: 0, workToDate: 3333.33 });
eq("odd amount: retention rounds to the cent", odd.retention, 250);
eq("odd amount: net plus retention equals gross", odd.net.plus(odd.retention).equals(odd.gross), true);
eq("no retention when the rate is zero", certify({ revisedValue: 1000, retentionPct: 0, previousToDate: 0, workToDate: 400 }).net, 400);

// Guards.
throws("cannot certify the same total again", () => certify({ revisedValue: 50000, retentionPct: 5, previousToDate: 20000, workToDate: 20000 }), "already certified");
throws("cannot certify less than before", () => certify({ revisedValue: 50000, retentionPct: 5, previousToDate: 20000, workToDate: 15000 }), "already certified");
throws("cannot certify more than the contract", () => certify({ revisedValue: 50000, retentionPct: 5, previousToDate: 0, workToDate: 50000.01 }), "cannot be more than the contract value");
eq("can certify exactly the full value", certify({ revisedValue: 50000, retentionPct: 5, previousToDate: 35000, workToDate: 50000 }).gross, 15000);
throws("retention above 100% is refused", () => certify({ revisedValue: 50000, retentionPct: 101, previousToDate: 0, workToDate: 100 }), "between 0 and 100");

// Variations change the value that can be certified.
eq("approved variations add to the contract value", revisedValue(50000, [10000, -2000]), 58000);
eq("a certificate can now go higher", certify({ revisedValue: 58000, retentionPct: 5, previousToDate: 50000, workToDate: 58000 }).gross, 8000);
throws("a variation cannot take the value below what is certified", () => checkRevision(30000, 35000), "less than the 35000.00 already certified");
eq("a variation to exactly the certified amount is allowed", (() => { checkRevision(35000, 35000); return "ok"; })(), "ok");

// Retention held.
eq("retention held = withheld less released", retentionHeld([1000, 750], [500]), 1250);

// Programme.
const plan = [{ amount: 15000, dueDate: new Date("2026-08-01") }, { amount: 15000, dueDate: new Date("2026-09-01") }, { amount: 20000, dueDate: new Date("2026-12-01") }];
eq("planned to date counts only items already due", behindSchedule(plan, 0, new Date("2026-09-15")).planned, 30000);
eq("behind by planned minus certified", behindSchedule(plan, 20000, new Date("2026-09-15")).behind, 10000);
eq("not behind when certified is ahead", behindSchedule(plan, 40000, new Date("2026-09-15")).behind, 0);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
