import { db } from "@/lib/db";
import { idsOf, type Scope } from "@/lib/scope-rules";
import { D, ZERO, sum, type Money } from "@/lib/money";
import { daysOverdue, forecastEnd, isOverdue, projectProgress } from "@/lib/operations";

// Reads a project's day from the other modules, so a site report never asks anyone to retype what the system already knows.

export const todayUtc = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

export async function siteDay(projectId: string, date: Date) {
  const [attendance, usage, issues, expenses] = await Promise.all([
    db.attendance.findMany({ where: { projectId, date }, include: { employee: { select: { name: true, position: true } } } }),
    db.assetUsage.findMany({ where: { projectId, date }, include: { asset: { select: { name: true, kind: true } } } }),
    db.stockMovement.findMany({ where: { projectId, date, type: "ISSUE", voided: false }, include: { material: { select: { name: true, unit: true } } } }),
    db.expense.findMany({ where: { projectId, date, status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { amount: true } }),
  ]);
  const atWork = attendance.filter((a) => a.status === "PRESENT" || a.status === "HALF_DAY");
  return {
    workers: atWork.length,
    absent: attendance.filter((a) => a.status === "ABSENT").length,
    overtime: sum(attendance.map((a) => a.overtimeHours)),
    equipment: usage.filter((u) => u.asset.kind === "EQUIPMENT").map((u) => ({ name: u.asset.name, hours: D(u.units) })),
    vehicles: usage.filter((u) => u.asset.kind === "VEHICLE").map((u) => ({ name: u.asset.name, km: D(u.units), trips: u.trips })),
    materials: issues.map((m) => ({ name: m.material.name, quantity: D(m.quantity).abs(), unit: m.material.unit, value: D(m.value) })),
    materialValue: sum(issues.map((m) => m.value)),
    spend: sum(expenses.map((e) => e.amount)),
    spendCount: expenses.length,
    fuel: sum(usage.map((u) => u.fuelLitres)),
  };
}

// One line per active project for the daily dashboard.
export async function operationsOverview(date: Date, scope: Scope = { all: true }) {
  const ids = idsOf(scope);
  const projects = await db.project.findMany({ where: { status: "ACTIVE", id: ids ? { in: ids } : undefined }, orderBy: { code: "asc" } });
  const out = [];
  for (const p of projects) {
    const [day, report, tasks, issues] = await Promise.all([
      siteDay(p.id, date),
      db.siteReport.findUnique({ where: { projectId_date: { projectId: p.id, date } }, select: { id: true, status: true } }),
      db.task.findMany({ where: { projectId: p.id } }),
      db.siteIssue.findMany({ where: { projectId: p.id } }),
    ]);
    const updatesToday = await db.reportTaskUpdate.findMany({ where: { report: { projectId: p.id, date } }, include: { task: { select: { title: true } } } });
    const open = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
    const daysLost = sum(issues.filter((i) => !i.resolved).map((i) => i.daysLost));
    out.push({
      project: p, day, report, updatesToday,
      done: tasks.filter((t) => t.status === "DONE").length,
      open: open.length,
      overdue: open.filter((t) => isOverdue(t, date)).length,
      blocked: tasks.filter((t) => t.status === "BLOCKED").length,
      taskProgress: projectProgress(tasks.map((t) => ({ completion: t.completion, status: t.status, estimatedCost: t.estimatedCost ? Number(t.estimatedCost) : null }))),
      openIssues: issues.filter((i) => !i.resolved).length,
      daysLost,
      forecast: forecastEnd(p.expectedEnd, Number(daysLost)),
    });
  }
  return out;
}

// What each task has actually cost so far: approved and paid expenses tagged to it.
export async function taskCosts(projectId?: string, scope: Scope = { all: true }): Promise<Map<string, Money>> {
  const ids = idsOf(scope);
  const g = await db.expense.groupBy({ by: ["taskId"], where: { taskId: { not: null }, status: { in: ["APPROVED", "PAID"] }, task: projectId ? { projectId } : ids ? { projectId: { in: ids } } : undefined }, _sum: { amount: true } });
  return new Map(g.map((x) => [x.taskId as string, D(x._sum.amount)]));
}

// Alerts for the Overview: overdue and blocked tasks, open delays, and missing daily reports.
export async function siteAlerts(previousWorkingDay: Date, today: Date, scope: Scope = { all: true }) {
  const ids = idsOf(scope);
  const out: { tone: "bad" | "warn"; text: string; href: string }[] = [];
  const projects = await db.project.findMany({ where: { status: "ACTIVE", id: ids ? { in: ids } : undefined }, orderBy: { code: "asc" }, include: { tasks: true, siteIssues: { where: { resolved: false } } } });
  for (const p of projects) {
    const open = p.tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
    const late = open.filter((t) => isOverdue(t, today)).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    if (late.length) out.push({ tone: "bad", text: `${p.code}: ${late.length} task${late.length === 1 ? " is" : "s are"} overdue. The oldest, "${late[0].title}", is ${daysOverdue(late[0].dueDate, today)} day${daysOverdue(late[0].dueDate, today) === 1 ? "" : "s"} late`, href: "/operations?tab=tasks" });
    const blocked = p.tasks.filter((t) => t.status === "BLOCKED");
    if (blocked.length) out.push({ tone: "warn", text: `${p.code}: ${blocked.length} task${blocked.length === 1 ? " is" : "s are"} blocked`, href: "/operations?tab=tasks" });
    if (p.siteIssues.length) {
      const lost = sum(p.siteIssues.map((i) => i.daysLost));
      out.push({ tone: lost.greaterThan(0) ? "warn" : "warn", text: `${p.code}: ${p.siteIssues.length} open site issue${p.siteIssues.length === 1 ? "" : "s"}${lost.greaterThan(0) ? `, ${lost.toString()} days lost so far` : ""}`, href: "/operations?tab=issues" });
    }
    const had = await db.siteReport.findUnique({ where: { projectId_date: { projectId: p.id, date: previousWorkingDay } }, select: { id: true } });
    if (!had && p.startDate && p.startDate <= previousWorkingDay) {
      out.push({ tone: "warn", text: `${p.code}: no site report for ${previousWorkingDay.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`, href: `/operations/reports/new?project=${p.id}` });
    }
  }
  return out;
}

export { ZERO };
