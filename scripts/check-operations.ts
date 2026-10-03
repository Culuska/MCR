import { afterProgress, daysOverdue, forecastEnd, isOverdue, isRestDay, previousWorkingDay, projectProgress, workingDaysBetween } from "../src/lib/operations";

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
const d = (s: string) => new Date(s + "T00:00:00Z");

// 2026-10-02 is a Friday, the weekly rest day.
eq("Friday is the rest day", isRestDay(d("2026-10-02")), true);
eq("Saturday is a working day", isRestDay(d("2026-10-03")), false);
eq("the working day before Saturday is Thursday (Friday is skipped)", previousWorkingDay(d("2026-10-03")).toISOString().slice(0, 10), "2026-10-01");
eq("the working day before Sunday is Saturday", previousWorkingDay(d("2026-10-04")).toISOString().slice(0, 10), "2026-10-03");
eq("working days from Sat 26 Sep to Thu 1 Oct: 6", workingDaysBetween(d("2026-09-26"), d("2026-10-01")), 6);
eq("a span that includes a Friday leaves it out", workingDaysBetween(d("2026-09-26"), d("2026-10-03")), 7);

// Overdue.
eq("a task past its due date and not done is overdue", isOverdue({ status: "IN_PROGRESS", dueDate: d("2026-09-30") }, d("2026-10-03")), true);
eq("a task due today is not overdue yet", isOverdue({ status: "TODO", dueDate: d("2026-10-03") }, d("2026-10-03")), false);
eq("a finished task is never overdue", isOverdue({ status: "DONE", dueDate: d("2026-09-01") }, d("2026-10-03")), false);
eq("a cancelled task is never overdue", isOverdue({ status: "CANCELLED", dueDate: d("2026-09-01") }, d("2026-10-03")), false);
eq("days overdue", daysOverdue(d("2026-09-30"), d("2026-10-03")), 3);
eq("not negative before the due date", daysOverdue(d("2026-10-10"), d("2026-10-03")), 0);

// Progress.
eq("first progress starts the task", JSON.stringify(afterProgress({ status: "TODO", completion: 0 }, 30)), '{"status":"IN_PROGRESS","completion":30}');
eq("100% finishes the task", JSON.stringify(afterProgress({ status: "IN_PROGRESS", completion: 60 }, 100)), '{"status":"DONE","completion":100}');
eq("progress on a blocked task puts it back in progress", afterProgress({ status: "BLOCKED", completion: 20 }, 40).status, "IN_PROGRESS");
eq("zero progress leaves a waiting task waiting", afterProgress({ status: "TODO", completion: 0 }, 0).status, "TODO");
throws("progress cannot go down", () => afterProgress({ status: "IN_PROGRESS", completion: 60 }, 50), "can only go up");
throws("progress above 100 is refused", () => afterProgress({ status: "IN_PROGRESS", completion: 60 }, 101), "0 to 100");
throws("progress must be whole", () => afterProgress({ status: "IN_PROGRESS", completion: 60 }, 60.5), "whole number");
throws("a finished task cannot take progress", () => afterProgress({ status: "DONE", completion: 100 }, 100), "Reopen it");

// Project progress.
eq("equal weights when tasks have no estimate", projectProgress([{ completion: 100, status: "DONE" }, { completion: 50, status: "IN_PROGRESS" }, { completion: 0, status: "TODO" }]), 50);
eq("weighted by estimated cost", projectProgress([{ completion: 100, status: "DONE", estimatedCost: 9000 }, { completion: 0, status: "TODO", estimatedCost: 1000 }]), 90);
eq("cancelled tasks do not count", projectProgress([{ completion: 100, status: "DONE" }, { completion: 0, status: "CANCELLED" }]), 100);
eq("no tasks means zero", projectProgress([]), 0);
eq("a mix of with and without estimates falls back to equal weights", projectProgress([{ completion: 100, status: "DONE", estimatedCost: 9000 }, { completion: 0, status: "TODO" }]), 50);

// Delays move the finish.
eq("5 days lost pushes the finish back 5 days", forecastEnd(d("2026-12-01"), 5)?.toISOString().slice(0, 10), "2026-12-06");
eq("no finish date, no forecast", forecastEnd(null, 5), null);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
