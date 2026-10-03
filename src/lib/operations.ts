// Site operations rules, in one place.
//   Friday is the weekly rest day. A report is expected on every other day.
//   A task is overdue when its due date has passed and it is not done or cancelled.
//   Progress only goes up through reports and quick updates. 100% means done. Any progress on a task that
//   was waiting or blocked means it is in progress.
//   Project progress is the average of its tasks' completion, weighted by estimated cost where there is one.
//   Days lost to delays push the expected finish date back.

export class OperationsError extends Error {}

export type TaskState = { status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED"; completion: number };

export const isRestDay = (d: Date) => d.getUTCDay() === 5;
const DAY = 86400000;

// The most recent working day strictly before `date`.
export function previousWorkingDay(date: Date): Date {
  let d = new Date(date.getTime() - DAY);
  while (isRestDay(d)) d = new Date(d.getTime() - DAY);
  return d;
}

export const isOverdue = (t: { status: TaskState["status"]; dueDate: Date }, today: Date) =>
  t.status !== "DONE" && t.status !== "CANCELLED" && t.dueDate.getTime() < today.getTime();

export const daysOverdue = (dueDate: Date, today: Date) => Math.max(0, Math.round((today.getTime() - dueDate.getTime()) / DAY));

// What a task becomes when its progress is reported.
export function afterProgress(task: TaskState, completion: number): TaskState {
  if (!Number.isInteger(completion) || completion < 0 || completion > 100) throw new OperationsError("Progress must be a whole number from 0 to 100.");
  if (task.status === "DONE" || task.status === "CANCELLED") throw new OperationsError(`This task is ${task.status.toLowerCase()}. Reopen it before reporting progress.`);
  if (completion < task.completion) throw new OperationsError(`Progress can only go up. This task is already at ${task.completion}%.`);
  if (completion === 100) return { status: "DONE", completion: 100 };
  return { status: completion > 0 ? "IN_PROGRESS" : task.status, completion };
}

// Weighted by estimated cost where tasks have one, otherwise every task counts the same.
export function projectProgress(tasks: { completion: number; status: TaskState["status"]; estimatedCost?: number | null }[]): number {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  if (!live.length) return 0;
  const weighted = live.every((t) => (t.estimatedCost ?? 0) > 0);
  const weight = (t: (typeof live)[number]) => (weighted ? (t.estimatedCost as number) : 1);
  const total = live.reduce((a, t) => a + weight(t), 0);
  return Math.round(live.reduce((a, t) => a + t.completion * weight(t), 0) / total);
}

// Days lost to delays move the finish date out by the same number of days. Only open delays are still hurting.
export function forecastEnd(expectedEnd: Date | null, daysLost: number): Date | null {
  if (!expectedEnd) return null;
  return new Date(expectedEnd.getTime() + Math.round(daysLost) * DAY);
}

export function workingDaysBetween(from: Date, to: Date): number {
  let n = 0;
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = new Date(d.getTime() + DAY)) if (!isRestDay(d)) n++;
  return n;
}
