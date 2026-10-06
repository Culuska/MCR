"use server";

import { revalidatePath } from "next/cache";
import { assertProject, assertRecord } from "@/lib/scope";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { D, fmtDate } from "@/lib/money";
import { OperationsError, afterProgress } from "@/lib/operations";
import { date, formObject, optionalAmount, optionalDate, optionalText, run, type FormState } from "@/lib/action";
import { IssueKind, Priority, TaskStatus } from "@/generated/prisma/enums";

const refresh = () => revalidatePath("/", "layout");
const endOfToday = () => { const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d; };
const iso = (d: Date) => d.toISOString().slice(0, 10);

function rules<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof OperationsError) throw new ActionError(e.message); throw e; }
}

async function liveProject(tx: Tx, projectId: string, statuses: string[] = ["PLANNING", "ACTIVE", "ON_HOLD"]) {
  const p = await tx.project.findUnique({ where: { id: projectId } });
  if (!p) throw new ActionError("That project does not exist.");
  if (!statuses.includes(p.status)) throw new ActionError(`Project ${p.code} is ${p.status.toLowerCase().replace("_", " ")}.`);
  return p;
}

/* ------------------------------------------- tasks ------------------------------------------ */

const taskSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1, "Choose the project."), title: z.string().trim().min(3, "Give the task a name."),
  description: optionalText, assigneeId: optionalText, startDate: optionalDate, dueDate: date,
  priority: z.enum(Priority), status: z.enum(TaskStatus).optional(),
  completion: z.coerce.number().int("Progress must be a whole number.").min(0).max(100).optional(),
  estimatedCost: optionalAmount, notes: optionalText,
});

export async function saveTask(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("operations");
    const v = taskSchema.parse(formObject(fd));
    await assertProject(user, v.projectId);
    if (v.id) await assertRecord(user, "task", v.id);
    if (v.startDate && v.dueDate < v.startDate) throw new ActionError("The due date cannot be before the start date.");
    return db.$transaction(async (tx) => {
      const base = { projectId: v.projectId, title: v.title, description: v.description ?? null, assigneeId: v.assigneeId ?? null, startDate: v.startDate ?? null, dueDate: v.dueDate, priority: v.priority, estimatedCost: v.estimatedCost == null ? null : D(v.estimatedCost), notes: v.notes ?? null };
      if (!v.id) {
        const p = await liveProject(tx, v.projectId);
        const number = await nextNumber(tx, "TSK");
        const t = await tx.task.create({ data: { ...base, number, createdById: user.id } });
        await audit({ userId: user.id, action: "task.create", entity: "Task", entityId: t.id, summary: `${user.name} added task ${number} to ${p.code}: ${v.title}, due ${fmtDate(v.dueDate)}` }, tx);
        refresh();
        return `${number} added`;
      }
      const before = await tx.task.findUniqueOrThrow({ where: { id: v.id } });
      let status = v.status ?? before.status;
      let completion = v.completion ?? before.completion;
      if (status === "DONE") completion = 100;
      else if (completion === 100 && status !== "CANCELLED") status = "DONE";
      if (before.status === "DONE" && status !== "DONE" && status !== "CANCELLED") completion = Math.min(completion, 99); // reopening cannot leave it at 100
      if ((status === "BLOCKED" || status === "CANCELLED") && !v.notes) throw new ActionError(`Say why in the notes before marking it ${status.toLowerCase()}.`);
      const data = { ...base, status, completion, completedAt: status === "DONE" ? before.completedAt ?? new Date() : null };
      await tx.task.update({ where: { id: v.id }, data });
      const moved = [
        before.status !== status && `status ${before.status.toLowerCase().replace("_", " ")} to ${status.toLowerCase().replace("_", " ")}`,
        before.completion !== completion && `progress ${before.completion}% to ${completion}%`,
        iso(before.dueDate) !== iso(v.dueDate) && `due date ${fmtDate(before.dueDate)} to ${fmtDate(v.dueDate)}`,
      ].filter(Boolean);
      await audit({ userId: user.id, action: "task.update", entity: "Task", entityId: v.id, summary: `${user.name} updated ${before.number}${moved.length ? ": " + moved.join(", ") : ""}` }, tx);
      refresh();
      return `${before.number} saved`;
    });
  });
}

const progressSchema = z.object({ id: z.string(), completion: z.coerce.number({ error: "Enter the progress." }), note: optionalText });

export async function updateTaskProgress(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("operations");
    const v = progressSchema.parse(formObject(fd));
    await assertRecord(user, "task", v.id);
    return db.$transaction(async (tx) => {
      const t = await tx.task.findUniqueOrThrow({ where: { id: v.id } });
      const next = rules(() => afterProgress(t, v.completion));
      await tx.task.update({ where: { id: v.id }, data: { ...next, completedAt: next.status === "DONE" ? new Date() : t.completedAt, notes: v.note ? `${t.notes ? t.notes + " | " : ""}${iso(new Date())}: ${v.note}` : t.notes } });
      await audit({ userId: user.id, action: "task.progress", entity: "Task", entityId: v.id, summary: `${user.name} moved ${t.number} (${t.title}) from ${t.completion}% to ${next.completion}%${next.status === "DONE" ? ", done" : ""}` }, tx);
      refresh();
      return next.status === "DONE" ? `${t.number} is done` : `${t.number} is ${next.completion}% complete`;
    });
  });
}

export async function setTaskState(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("operations");
    const { id, to, reason } = z.object({ id: z.string(), to: z.enum(["BLOCK", "UNBLOCK", "CANCEL", "REOPEN"]), reason: optionalText }).parse(formObject(fd));
    await assertRecord(user, "task", id);
    return db.$transaction(async (tx) => {
      const t = await tx.task.findUniqueOrThrow({ where: { id } });
      const note = (extra?: string | null) => (extra ? `${t.notes ? t.notes + " | " : ""}${iso(new Date())}: ${extra}` : t.notes);
      if (to === "BLOCK") {
        if (t.status !== "TODO" && t.status !== "IN_PROGRESS") throw new ActionError(`${t.number} is ${t.status.toLowerCase().replace("_", " ")}, so it cannot be blocked.`);
        if (!reason) throw new ActionError("Say what is blocking it.");
        await tx.task.update({ where: { id }, data: { status: "BLOCKED", notes: note(`Blocked: ${reason}`) } });
      } else if (to === "UNBLOCK") {
        if (t.status !== "BLOCKED") throw new ActionError(`${t.number} is not blocked.`);
        await tx.task.update({ where: { id }, data: { status: t.completion > 0 ? "IN_PROGRESS" : "TODO", notes: note(reason ? `Unblocked: ${reason}` : "Unblocked") } });
      } else if (to === "CANCEL") {
        if (t.status === "DONE" || t.status === "CANCELLED") throw new ActionError(`${t.number} is already ${t.status.toLowerCase()}.`);
        if (!reason) throw new ActionError("Say why it is being cancelled.");
        await tx.task.update({ where: { id }, data: { status: "CANCELLED", notes: note(`Cancelled: ${reason}`) } });
      } else {
        if (t.status !== "DONE" && t.status !== "CANCELLED") throw new ActionError(`${t.number} is not finished or cancelled.`);
        const completion = Math.min(t.completion, 99);
        await tx.task.update({ where: { id }, data: { status: completion > 0 ? "IN_PROGRESS" : "TODO", completion, completedAt: null, notes: note(reason ? `Reopened: ${reason}` : "Reopened") } });
      }
      await audit({ userId: user.id, action: `task.${to.toLowerCase()}`, entity: "Task", entityId: id, summary: `${user.name} ${to === "BLOCK" ? "blocked" : to === "UNBLOCK" ? "unblocked" : to === "CANCEL" ? "cancelled" : "reopened"} ${t.number} (${t.title})${reason ? `: ${reason}` : ""}` }, tx);
      refresh();
      return `${t.number} updated`;
    });
  });
}

/* ---------------------------------------- site reports ---------------------------------------- */

const reportSchema = z.object({
  projectId: z.string().min(1, "Choose the project."), date, weather: optionalText,
  workDone: z.string().trim().min(10, "Describe the work done today in a sentence or two."), planNext: optionalText, notes: optionalText,
});
const MAX_ISSUES = 3;

export async function saveSiteReport(_: FormState, fd: FormData): Promise<FormState> {
  let reportId: string | null = null;
  const result = await run(async () => {
    const user = await requireWrite("operations");
    const raw = formObject(fd);
    const v = reportSchema.parse(raw);
    await assertProject(user, v.projectId);
    if (v.date > endOfToday()) throw new ActionError("You cannot write a report for a future date.");

    const issues: { kind: keyof typeof IssueKind; description: string; daysLost: number }[] = [];
    for (let k = 0; k < MAX_ISSUES; k++) {
      const description = String(raw[`id_${k}`] ?? "").trim();
      if (!description) continue;
      const kind = String(raw[`ik_${k}`] ?? "");
      if (!(kind in IssueKind)) throw new ActionError(`Issue ${k + 1}: choose what kind of problem it is.`);
      const daysLost = Number(raw[`dl_${k}`] || 0);
      if (Number.isNaN(daysLost) || daysLost < 0 || daysLost > 60) throw new ActionError(`Issue ${k + 1}: days lost must be between 0 and 60.`);
      if (description.length < 5) throw new ActionError(`Issue ${k + 1}: describe the problem.`);
      issues.push({ kind: kind as keyof typeof IssueKind, description, daysLost });
    }

    return db.$transaction(async (tx) => {
      const p = await liveProject(tx, v.projectId, ["ACTIVE"]);
      const dup = await tx.siteReport.findUnique({ where: { projectId_date: { projectId: v.projectId, date: v.date } } });
      if (dup) throw new ActionError(`There is already a report for ${p.code} on ${fmtDate(v.date)}. Open it to review it.`);

      const report = await tx.siteReport.create({ data: { projectId: v.projectId, date: v.date, weather: v.weather ?? null, workDone: v.workDone, planNext: v.planNext ?? null, notes: v.notes ?? null, createdById: user.id } });

      // Progress on tasks, reported in the same sitting. Each task must belong to this project and can only move forward.
      const tasks = await tx.task.findMany({ where: { projectId: v.projectId } });
      let touched = 0;
      for (const t of tasks) {
        const text = String(raw[`t_${t.id}`] ?? "").trim();
        const note = String(raw[`n_${t.id}`] ?? "").trim();
        if (!text) continue;
        const next = rules(() => { try { return afterProgress(t, Number(text)); } catch (e) { if (e instanceof OperationsError) throw new OperationsError(`${t.title}: ${e.message}`); throw e; } });
        if (next.completion === t.completion && !note) continue;
        await tx.task.update({ where: { id: t.id }, data: { ...next, completedAt: next.status === "DONE" ? new Date() : t.completedAt } });
        await tx.reportTaskUpdate.create({ data: { reportId: report.id, taskId: t.id, completion: next.completion, note: note || null } });
        touched++;
      }
      for (const i of issues) {
        const number = await nextNumber(tx, "ISS");
        await tx.siteIssue.create({ data: { number, projectId: v.projectId, reportId: report.id, date: v.date, kind: i.kind, description: i.description, daysLost: D(i.daysLost), createdById: user.id } });
      }
      await audit({ userId: user.id, action: "report.create", entity: "SiteReport", entityId: report.id, summary: `${user.name} filed the ${p.code} site report for ${fmtDate(v.date)}${touched ? `, updated ${touched} task${touched === 1 ? "" : "s"}` : ""}${issues.length ? `, raised ${issues.length} issue${issues.length === 1 ? "" : "s"}` : ""}` }, tx);
      reportId = report.id;
      refresh();
      return `Report filed for ${p.code}`;
    });
  });
  return reportId && result?.ok ? { ok: `${result.ok}|${reportId}` } : result;
}

export async function reviewReport(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("operations");
    if (user.role !== "PROJECT_MANAGER" && user.role !== "SUPER_ADMIN") throw new ActionError("A project manager reviews site reports.");
    const { id } = z.object({ id: z.string() }).parse(formObject(fd));
    await assertRecord(user, "siteReport", id);
    return db.$transaction(async (tx) => {
      const r = await tx.siteReport.findUniqueOrThrow({ where: { id }, include: { project: true } });
      if (r.status === "REVIEWED") throw new ActionError("That report has already been reviewed.");
      if (r.createdById === user.id && user.role !== "SUPER_ADMIN") throw new ActionError("You wrote this report, so someone else has to review it.");
      await tx.siteReport.update({ where: { id }, data: { status: "REVIEWED", reviewedById: user.id } });
      await audit({ userId: user.id, action: "report.review", entity: "SiteReport", entityId: id, summary: `${user.name} reviewed the ${r.project.code} site report for ${fmtDate(r.date)}` }, tx);
      refresh();
      return "Report reviewed";
    });
  });
}

/* -------------------------------------- issues and delays -------------------------------------- */

const issueSchema = z.object({
  projectId: z.string().min(1, "Choose the project."), taskId: optionalText, date, kind: z.enum(IssueKind, { error: "Choose the kind of problem." }),
  description: z.string().trim().min(5, "Describe the problem."), daysLost: z.coerce.number().min(0, "Days lost cannot be negative.").max(60, "Days lost cannot be more than 60.").default(0),
});

export async function addIssue(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("operations");
    const v = issueSchema.parse(formObject(fd));
    await assertProject(user, v.projectId);
    if (v.date > endOfToday()) throw new ActionError("The date cannot be in the future.");
    return db.$transaction(async (tx) => {
      const p = await liveProject(tx, v.projectId);
      if (v.taskId) {
        const t = await tx.task.findUnique({ where: { id: v.taskId } });
        if (!t || t.projectId !== v.projectId) throw new ActionError("That task is not on this project.");
      }
      const number = await nextNumber(tx, "ISS");
      const i = await tx.siteIssue.create({ data: { number, projectId: v.projectId, taskId: v.taskId ?? null, date: v.date, kind: v.kind, description: v.description, daysLost: D(v.daysLost), createdById: user.id } });
      await audit({ userId: user.id, action: "issue.create", entity: "SiteIssue", entityId: i.id, summary: `${user.name} logged ${number} on ${p.code}: ${v.description}${v.daysLost ? `, ${v.daysLost} days lost` : ""}` }, tx);
      refresh();
      return `${number} logged`;
    });
  });
}

export async function resolveIssue(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("operations");
    const { id, reason } = z.object({ id: z.string(), reason: z.string().trim().min(3, "Say how it was resolved.") }).parse(formObject(fd));
    await assertRecord(user, "siteIssue", id);
    return db.$transaction(async (tx) => {
      const i = await tx.siteIssue.findUniqueOrThrow({ where: { id }, include: { project: true } });
      if (i.resolved) throw new ActionError(`${i.number} is already resolved.`);
      await tx.siteIssue.update({ where: { id }, data: { resolved: true, resolvedAt: new Date(), resolution: reason } });
      await audit({ userId: user.id, action: "issue.resolve", entity: "SiteIssue", entityId: id, summary: `${user.name} resolved ${i.number} on ${i.project.code}: ${reason}` }, tx);
      refresh();
      return `${i.number} resolved`;
    });
  });
}
