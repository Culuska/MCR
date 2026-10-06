import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { operationsOverview, taskCosts, todayUtc } from "@/lib/site";
import { daysOverdue, isOverdue } from "@/lib/operations";
import { addIssue, resolveIssue, saveTask, setTaskState, updateTaskProgress } from "@/actions/operations";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { Bar, Empty, Field, Kpi, PageHead, Pill, Tabs, clean } from "@/components/ui";
import { D, fmt, fmtDate, toDateInput } from "@/lib/money";
import { label } from "@/lib/domain";
import { IssueKind, Priority, TaskStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Site operations" };

const TABS = [{ key: "today", label: "Today" }, { key: "tasks", label: "Tasks" }, { key: "reports", label: "Site reports" }, { key: "issues", label: "Issues and delays" }];
type SP = { tab?: string; date?: string; project?: string; status?: string; edit?: string };
const box = { padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" } as const;

export default async function Operations({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireRead("operations");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "today";
  const writer = canWrite(user.role, "operations");
  return (
    <>
      <PageHead title="Site operations" sub="What happened on site, what is still to do, and what is holding work up" />
      <Tabs current={tab} items={TABS.map((t) => ({ ...t, href: `/operations?tab=${t.key}` }))} />
      {tab === "today" && <Today date={sp.date} writer={writer} />}
      {tab === "tasks" && <Tasks sp={sp} writer={writer} />}
      {tab === "reports" && <Reports writer={writer} />}
      {tab === "issues" && <Issues writer={writer} />}
    </>
  );
}

async function Today({ date, writer }: { date?: string; writer: boolean }) {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + "T00:00:00Z") : todayUtc();
  const rows = await operationsOverview(day);
  const isToday = day.getTime() === todayUtc().getTime();
  return (
    <>
      <form className="filters" action="/operations">
        <input type="hidden" name="tab" value="today" />
        <input type="date" name="date" defaultValue={toDateInput(day)} max={toDateInput(todayUtc())} aria-label="Date" />
        <button className="btn" type="submit">Show day</button>
        {!isToday && <Link className="small" href="/operations">Back to today</Link>}
      </form>
      {rows.length === 0 ? <Empty title="No active projects">Projects marked Active appear here with their day on site.</Empty> : rows.map((r) => (
        <section key={r.project.id} className="panel">
          <div className="panel-head">
            <h2><Link href={`/projects/${r.project.id}`} style={{ color: "inherit" }}>{r.project.code}</Link> <span className="muted" style={{ fontFamily: "var(--f-body)", textTransform: "none", letterSpacing: 0 }}>{clean(r.project.name)}</span></h2>
            <div className="row">
              {r.report ? <Link className="btn sm" href={`/operations/reports/${r.report.id}`}>Site report: {r.report.status === "REVIEWED" ? "reviewed" : "filed"}</Link>
                : writer && isToday ? <Link className="btn sm primary" href={`/operations/reports/new?project=${r.project.id}`}>Write today&apos;s report</Link> : <span className="pill warn">No report</span>}
            </div>
          </div>
          <section className="kpis">
            <Kpi label="Workers on site" value={String(r.day.workers)} sub={`${r.day.absent} absent${Number(r.day.overtime) ? ` · ${String(r.day.overtime)} h overtime` : ""}`} />
            <Kpi label="Machines and trucks" value={`${r.day.equipment.length + r.day.vehicles.length}`} sub={r.day.equipment.length + r.day.vehicles.length ? [...r.day.equipment.map((e) => `${e.name.replace(" (sample)", "")} ${String(e.hours)}h`), ...r.day.vehicles.map((v) => `${v.name.replace(" (sample)", "")} ${v.trips} trips`)].slice(0, 3).join(", ") : "None logged"} />
            <Kpi label="Material used" value={fmt(r.day.materialValue)} sub={r.day.materials.length ? r.day.materials.map((m) => `${String(m.quantity)} ${m.unit} ${m.name.replace(" (sample)", "")}`).slice(0, 2).join(", ") : "Nothing issued"} />
            <Kpi label="Spent today" value={fmt(r.day.spend)} sub={`${r.day.spendCount} expense${r.day.spendCount === 1 ? "" : "s"}${Number(r.day.fuel) ? ` · ${r.day.fuel.toFixed(0)} L fuel` : ""}`} />
          </section>
          <div className="grid2 even">
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div className="row"><span className="pill good">{r.done} done</span><span className="pill info">{r.open} open</span>{r.overdue > 0 && <span className="pill bad">{r.overdue} overdue</span>}{r.blocked > 0 && <span className="pill warn">{r.blocked} blocked</span>}</div>
              <div><div className="bar-top"><b>Progress from tasks</b><span className="num">{r.taskProgress}%</span></div><Bar used={r.taskProgress} /></div>
              <div><div className="bar-top"><b>Progress set on the project</b><span className="num">{r.project.progress}%</span></div><Bar used={r.project.progress} /></div>
            </div>
            <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <b className="label">Work completed {isToday ? "today" : "that day"}</b>
              {r.updatesToday.length === 0 ? <span className="muted small">No task progress was reported.</span> : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>{r.updatesToday.map((u) => <li key={u.id}>{u.task.title}: <b className="num">{u.completion}%</b>{u.note ? <span className="muted"> · {u.note}</span> : null}</li>)}</ul>
              )}
              {(r.openIssues > 0 || r.forecast) && (
                <span className="small muted">{r.openIssues > 0 ? `${r.openIssues} open issue${r.openIssues === 1 ? "" : "s"}, ${String(r.daysLost)} days lost. ` : ""}{r.project.expectedEnd ? `Planned finish ${fmtDate(r.project.expectedEnd)}${Number(r.daysLost) > 0 ? `, expected ${fmtDate(r.forecast)}` : ""}.` : ""}</span>
              )}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

async function Tasks({ sp, writer }: { sp: SP; writer: boolean }) {
  const today = todayUtc();
  const [tasks, projects, employees, costs] = await Promise.all([
    db.task.findMany({
      where: { projectId: sp.project || undefined, status: sp.status && sp.status in TaskStatus ? (sp.status as keyof typeof TaskStatus) : undefined },
      include: { project: true, assignee: { select: { name: true } } }, orderBy: [{ dueDate: "asc" }, { number: "asc" }],
    }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true, position: true }, orderBy: { name: "asc" } }),
    taskCosts(),
  ]);
  const editing = sp.edit ? tasks.find((t) => t.id === sp.edit) : undefined;
  const late = tasks.filter((t) => isOverdue(t, today));
  return (
    <>
      <section className="kpis">
        <Kpi label="Open tasks" value={String(tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED").length)} />
        <Kpi label="Overdue" value={String(late.length)} tone={late.length ? "out" : undefined} sub={late[0] ? `Oldest: ${late[0].title}` : "Nothing late"} />
        <Kpi label="Blocked" value={String(tasks.filter((t) => t.status === "BLOCKED").length)} />
        <Kpi label="Done" value={String(tasks.filter((t) => t.status === "DONE").length)} />
      </section>

      {writer && (
        <details className="more" open={!!editing}>
          <summary>{editing ? `Edit ${editing.number}` : "Add a task"}</summary>
          <div className="body">
            <ActionForm key={editing?.id ?? "new"} action={saveTask} goTo="/operations?tab=tasks" resetOnOk>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div className="fields">
                <Field name="projectId" label="Project"><select id="projectId" name="projectId" required defaultValue={editing?.projectId ?? ""}><option value="" disabled>Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {clean(p.name)}</option>)}</select></Field>
                <Field name="title" label="Task"><input id="title" name="title" required minLength={3} defaultValue={editing?.title} placeholder="Pour ground floor slab" /></Field>
                <Field name="assigneeId" label="Assigned to"><select id="assigneeId" name="assigneeId" defaultValue={editing?.assigneeId ?? ""}><option value="">Not assigned</option>{employees.map((e) => <option key={e.id} value={e.id}>{clean(e.name)}, {e.position}</option>)}</select></Field>
                <Field name="priority" label="Priority"><select id="priority" name="priority" defaultValue={editing?.priority ?? "MEDIUM"}>{Object.values(Priority).map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></Field>
                <Field name="startDate" label="Start"><input id="startDate" name="startDate" type="date" defaultValue={toDateInput(editing?.startDate)} /></Field>
                <Field name="dueDate" label="Due"><input id="dueDate" name="dueDate" type="date" required defaultValue={toDateInput(editing?.dueDate)} /></Field>
                <Field name="estimatedCost" label="Estimated cost (USD)"><input id="estimatedCost" name="estimatedCost" type="number" step="0.01" min="0" defaultValue={editing?.estimatedCost?.toString() ?? ""} /></Field>
                {editing && <Field name="status" label="Status"><select id="status" name="status" defaultValue={editing.status}>{Object.values(TaskStatus).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>}
                {editing && <Field name="completion" label="Progress %" hint="Lowering it is recorded in the history."><input id="completion" name="completion" type="number" min="0" max="100" step="1" defaultValue={editing.completion} /></Field>}
                <Field name="description" label="Details" wide><input id="description" name="description" defaultValue={editing?.description ?? ""} /></Field>
                <Field name="notes" label="Notes" wide><input id="notes" name="notes" defaultValue={editing?.notes ?? ""} /></Field>
              </div>
              <div className="row"><Submit>{editing ? "Save task" : "Add task"}</Submit></div>
            </ActionForm>
          </div>
        </details>
      )}

      <form className="filters" action="/operations"><input type="hidden" name="tab" value="tasks" />
        <select name="project" defaultValue={sp.project ?? ""} aria-label="Project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">Any status</option>{Object.values(TaskStatus).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <button className="btn" type="submit">Filter</button>{(sp.project || sp.status) && <Link className="small" href="/operations?tab=tasks">Clear</Link>}
      </form>

      {tasks.length === 0 ? <Empty title="No tasks match">Add the work packages for each project so progress can be tracked.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Task</th><th>Project</th><th>Due</th><th>Priority</th><th>Status</th><th style={{ width: 170 }}>Progress</th><th className="r">Cost</th><th /></tr></thead>
          <tbody>{tasks.map((t) => {
            const over = isOverdue(t, today);
            const actual = costs.get(t.id) ?? D(0);
            const finished = t.status === "DONE" || t.status === "CANCELLED";
            return (
              <tr key={t.id} style={t.status === "CANCELLED" ? { opacity: 0.55 } : undefined}>
                <td><b>{t.title}</b><br /><span className="small muted num">{t.number}{t.assignee ? ` · ${clean(t.assignee.name)}` : ""}</span>{t.notes && <><br /><span className="small muted">{t.notes.slice(0, 80)}</span></>}</td>
                <td>{t.project.code}</td>
                <td className="num">{fmtDate(t.dueDate)}{over && <><br /><span className="pill bad">{daysOverdue(t.dueDate, today)} d late</span></>}</td>
                <td><Pill status={t.priority} /></td><td><Pill status={t.status} /></td>
                <td>
                  <Bar used={t.completion} />
                  {writer && !finished ? (
                    <ActionForm action={updateTaskProgress} className="inline-form">
                      <input type="hidden" name="id" value={t.id} />
                      <input name="completion" type="number" min={t.completion} max="100" step="1" defaultValue={t.completion} aria-label={`Progress for ${t.title}`} style={{ ...box, width: 72 }} />
                      <Submit className="btn sm">Update</Submit>
                    </ActionForm>
                  ) : <span className="small muted num">{t.completion}%</span>}
                </td>
                <td className="r num">{t.estimatedCost ? <>{fmt(actual)}<br /><span className={`small ${actual.greaterThan(t.estimatedCost) ? "out" : "muted"}`}>of {fmt(t.estimatedCost)}</span></> : actual.greaterThan(0) ? fmt(actual) : <span className="muted">—</span>}</td>
                <td>{writer && (
                  <div className="row">
                    <Link className="small" href={`/operations?tab=tasks&edit=${t.id}`}>Edit</Link>
                    <DeleteButton kind="task" id={t.id} name={t.number} />
                    {(t.status === "TODO" || t.status === "IN_PROGRESS") && <StepForm action={setTaskState} id={t.id} to="BLOCK" label="Block" ask="What is blocking it?" />}
                    {t.status === "BLOCKED" && <StepForm action={setTaskState} id={t.id} to="UNBLOCK" label="Unblock" primary />}
                    {finished ? <StepForm action={setTaskState} id={t.id} to="REOPEN" label="Reopen" /> : <StepForm action={setTaskState} id={t.id} to="CANCEL" label="Cancel" ask="Why?" danger />}
                  </div>
                )}</td>
              </tr>
            );
          })}</tbody>
        </table></div></section>
      )}
    </>
  );
}

async function Reports({ writer }: { writer: boolean }) {
  const reports = await db.siteReport.findMany({ include: { project: true, updates: true, issues: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 40 });
  const authors = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      {writer && <div className="row"><Link className="btn primary" href="/operations/reports/new">Write a site report</Link></div>}
      {reports.length === 0 ? <Empty title="No site reports yet">One report per project each working day: what was done, what is next, and what is in the way.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Project</th><th>Work done</th><th>Tasks updated</th><th>Issues</th><th>By</th><th>Status</th></tr></thead>
          <tbody>{reports.map((r) => (
            <tr key={r.id} className="link">
              <td className="num"><Link href={`/operations/reports/${r.id}`}>{fmtDate(r.date)}</Link></td><td>{r.project.code}</td>
              <td>{r.workDone.slice(0, 90)}{r.workDone.length > 90 ? "…" : ""}</td><td className="num">{r.updates.length || "—"}</td><td className="num">{r.issues.length || "—"}</td>
              <td>{authors.get(r.createdById) ?? "—"}</td><td><Pill status={r.status} /></td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}

async function Issues({ writer }: { writer: boolean }) {
  const [issues, projects, tasks] = await Promise.all([
    db.siteIssue.findMany({ include: { project: true, task: true }, orderBy: [{ resolved: "asc" }, { date: "desc" }], take: 80 }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.task.findMany({ where: { status: { notIn: ["DONE", "CANCELLED"] } }, include: { project: true }, orderBy: [{ project: { code: "asc" } }, { number: "asc" }] }),
  ]);
  const open = issues.filter((i) => !i.resolved);
  const lost = open.reduce((a, i) => a + Number(i.daysLost), 0);
  return (
    <>
      <section className="kpis">
        <Kpi label="Open issues" value={String(open.length)} tone={open.length ? "out" : undefined} />
        <Kpi label="Days lost, open" value={String(lost)} sub="Pushes planned finish dates out" />
        <Kpi label="Resolved" value={String(issues.length - open.length)} />
        <Kpi label="Safety items" value={String(issues.filter((i) => i.kind === "SAFETY").length)} sub="All time" />
      </section>
      {writer && (
        <details className="more"><summary>Log an issue or delay</summary><div className="body">
          <ActionForm action={addIssue} resetOnOk>
            <div className="fields">
              <Field name="projectId" label="Project"><select id="projectId" name="projectId" required defaultValue=""><option value="" disabled>Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
              <Field name="kind" label="Kind"><select id="kind" name="kind" required defaultValue=""><option value="" disabled>Choose…</option>{Object.values(IssueKind).map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></Field>
              <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(todayUtc())} max={toDateInput(todayUtc())} /></Field>
              <Field name="daysLost" label="Working days lost"><input id="daysLost" name="daysLost" type="number" min="0" max="60" step="0.5" defaultValue="0" /></Field>
              <Field name="taskId" label="Affects task"><select id="taskId" name="taskId" defaultValue=""><option value="">No particular task</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.project.code} · {t.title}</option>)}</select></Field>
              <Field name="description" label="What happened" wide><input id="description" name="description" required minLength={5} placeholder="Cement delivery late, slab pour postponed" /></Field>
            </div>
            <div className="row"><Submit>Log issue</Submit></div>
          </ActionForm>
        </div></details>
      )}
      {issues.length === 0 ? <Empty title="No issues logged">Delays, shortages, breakdowns and safety items go here so their cost in days is visible.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Issue</th><th>Project</th><th>Kind</th><th>What happened</th><th className="r">Days lost</th><th>Status</th><th /></tr></thead>
          <tbody>{issues.map((i) => (
            <tr key={i.id} style={i.resolved ? { opacity: 0.65 } : undefined}>
              <td className="num">{i.number}<br /><span className="small muted">{fmtDate(i.date)}</span></td><td>{i.project.code}</td><td>{label(i.kind)}</td>
              <td>{i.description}{i.task && <><br /><span className="small muted">Task: {i.task.title}</span></>}{i.resolution && <><br /><span className="small in">Resolved: {i.resolution}</span></>}</td>
              <td className="r num">{Number(i.daysLost) ? String(i.daysLost) : "—"}</td><td><Pill status={i.resolved ? "RESOLVED" : "OPEN"} /></td>
              <td>{writer && !i.resolved && <StepForm action={resolveIssue} id={i.id} to="RESOLVE" label="Resolve" ask="How was it resolved?" primary />}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}
