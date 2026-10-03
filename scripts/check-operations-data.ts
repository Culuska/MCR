import "dotenv/config";
import { db } from "../src/lib/db";

let bad = 0;
const flag = (ok: boolean, text: string) => { if (!ok) bad++; console.log(ok ? "ok  " : "FAIL", text); };

async function main() {
  const tasks = await db.task.findMany({ include: { updates: true, expenses: { select: { projectId: true, number: true } } } });

  // A task's status and its progress must agree.
  for (const t of tasks) {
    flag(t.completion >= 0 && t.completion <= 100, `${t.number}: progress ${t.completion}% is between 0 and 100`);
    if (t.status === "DONE") flag(t.completion === 100 && t.completedAt !== null, `${t.number}: a done task is at 100% and has a completion date`);
    else if (t.status !== "CANCELLED") flag(t.completion < 100 && t.completedAt === null, `${t.number}: an unfinished task is under 100% with no completion date`);
    // Reports only ever record forward progress, so none can be above where the task stands now.
    flag(t.updates.every((u) => u.completion <= t.completion), `${t.number}: no report claims more progress (${Math.max(0, ...t.updates.map((u) => u.completion))}%) than the task has now (${t.completion}%)`);
    flag(t.expenses.every((e) => e.projectId === t.projectId), `${t.number}: every expense tagged to it is on the same project`);
  }

  // At most one report per project per day, and none for a day that has not happened.
  const reports = await db.siteReport.findMany();
  const keys = reports.map((r) => `${r.projectId}|${r.date.toISOString().slice(0, 10)}`);
  flag(new Set(keys).size === keys.length, `${reports.length} site reports, one per project per day`);
  flag(reports.every((r) => r.date.getTime() <= Date.now()), "no report is dated in the future");

  // Report updates belong to tasks on the same project as the report.
  const ups = await db.reportTaskUpdate.findMany({ include: { report: true, task: true } });
  flag(ups.every((u) => u.report.projectId === u.task.projectId), `${ups.length} report task updates are on tasks of the report's own project`);

  // Resolved issues have a resolution, open ones do not.
  const issues = await db.siteIssue.findMany();
  flag(issues.every((i) => (i.resolved ? !!i.resolution && !!i.resolvedAt : !i.resolution && !i.resolvedAt)), `${issues.length} issues: resolved ones have a resolution and a date, open ones have neither`);

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
}
main().finally(() => db.$disconnect());
