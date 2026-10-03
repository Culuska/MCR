import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { siteDay, todayUtc } from "@/lib/site";
import { saveSiteReport } from "@/actions/operations";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field, PageHead, Pill, clean } from "@/components/ui";
import { fmt, fmtDate, toDateInput } from "@/lib/money";
import { label } from "@/lib/domain";
import { IssueKind } from "@/generated/prisma/enums";

export const metadata = { title: "New site report" };

const box = { padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" } as const;

export default async function NewReport({ searchParams }: { searchParams: Promise<{ project?: string; date?: string }> }) {
  const user = await requireRead("operations");
  if (!canWrite(user.role, "operations")) redirect("/operations?tab=reports");
  const sp = await searchParams;
  const projects = await db.project.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } });
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? new Date(sp.date + "T00:00:00Z") : todayUtc();
  const project = projects.find((p) => p.id === sp.project);

  const [facts, tasks, existing] = project ? await Promise.all([
    siteDay(project.id, date),
    db.task.findMany({ where: { projectId: project.id, status: { notIn: ["DONE", "CANCELLED"] } }, orderBy: [{ dueDate: "asc" }, { number: "asc" }] }),
    db.siteReport.findUnique({ where: { projectId_date: { projectId: project.id, date } }, select: { id: true } }),
  ]) : [null, [], null];

  return (
    <>
      <PageHead title="New site report" sub="One per project each working day. Workers, machines, material and spending are filled in from the other modules." />
      <form className="filters" action="/operations/reports/new">
        <select name="project" defaultValue={project?.id ?? ""} aria-label="Project" required><option value="" disabled>Choose a project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {clean(p.name)}</option>)}</select>
        <input type="date" name="date" defaultValue={toDateInput(date)} max={toDateInput(todayUtc())} aria-label="Date" />
        <button className="btn" type="submit">Start report</button>
      </form>

      {project && facts && (
        existing ? <div className="notice">There is already a report for {project.code} on {fmtDate(date)}. <a href={`/operations/reports/${existing.id}`}>Open it</a>.</div> : (
          <>
            <section className="panel">
              <h2>What the system already knows about {fmtDate(date)}</h2>
              <div className="tablewrap"><table><tbody>
                <tr><td className="muted">Workers on site</td><td>{facts.workers} present{facts.absent ? `, ${facts.absent} absent` : ""}{Number(facts.overtime) ? `, ${String(facts.overtime)} hours of overtime` : ""}<br /><span className="small muted">From the attendance sheet.</span></td></tr>
                <tr><td className="muted">Machines</td><td>{facts.equipment.length ? facts.equipment.map((e) => `${e.name.replace(" (sample)", "")} ${String(e.hours)} h`).join(", ") : "None logged"}</td></tr>
                <tr><td className="muted">Trucks and vehicles</td><td>{facts.vehicles.length ? facts.vehicles.map((v) => `${v.name.replace(" (sample)", "")} ${String(v.km)} km, ${v.trips} trips`).join(", ") : "None logged"}</td></tr>
                <tr><td className="muted">Material used</td><td>{facts.materials.length ? facts.materials.map((m) => `${String(m.quantity)} ${m.unit} ${m.name.replace(" (sample)", "")}`).join(", ") + ` (${fmt(facts.materialValue)})` : "Nothing issued from stock"}</td></tr>
                <tr><td className="muted">Spent</td><td>{fmt(facts.spend)} on {facts.spendCount} expense{facts.spendCount === 1 ? "" : "s"}</td></tr>
              </tbody></table></div>
              {facts.workers === 0 && <span className="small muted">No attendance has been recorded for this project on this day. Record it on the Attendance page.</span>}
            </section>

            <ActionForm action={saveSiteReport} goToPrefix="/operations/reports/">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="date" value={toDateInput(date)} />
              <div className="panel">
                <div className="fields">
                  <Field name="weather" label="Weather"><select id="weather" name="weather" defaultValue="">{["", "Clear and hot", "Cloudy", "Rain", "Strong wind", "Dust"].map((w) => <option key={w} value={w}>{w || "Not noted"}</option>)}</select></Field>
                  <Field name="workDone" label="Work done today" wide><textarea id="workDone" name="workDone" required minLength={10} placeholder="Poured the ground floor slab, bay 1 to 3. Block work continued on the east wall." /></Field>
                  <Field name="planNext" label="Planned for the next working day" wide><textarea id="planNext" name="planNext" /></Field>
                  <Field name="notes" label="Other notes" wide><input id="notes" name="notes" /></Field>
                </div>
              </div>

              {tasks.length > 0 && (
                <div className="panel">
                  <h2>Task progress</h2>
                  <span className="hint">Enter the new percentage for any task that moved. Leave blank if nothing changed. Progress can only go up.</span>
                  <div className="tablewrap"><table>
                    <thead><tr><th>Task</th><th>Due</th><th>Now</th><th style={{ width: 120 }}>New %</th><th>Note</th></tr></thead>
                    <tbody>{tasks.map((t) => (
                      <tr key={t.id}>
                        <td><b>{t.title}</b><br /><span className="small muted num">{t.number}</span></td><td className="num">{fmtDate(t.dueDate)}</td>
                        <td><Pill status={t.status} /> <span className="num">{t.completion}%</span></td>
                        <td><input name={`t_${t.id}`} type="number" min={t.completion} max="100" step="1" aria-label={`New progress for ${t.title}`} style={{ ...box, width: 90 }} /></td>
                        <td><input name={`n_${t.id}`} aria-label={`Note for ${t.title}`} style={{ ...box, width: "100%" }} /></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </div>
              )}

              <div className="panel">
                <h2>Problems today</h2>
                <span className="hint">Delays, shortages, breakdowns and safety items. Leave blank if there were none.</span>
                {[0, 1, 2].map((k) => (
                  <div key={k} className="fields three">
                    <Field name={`ik_${k}`} label={`Issue ${k + 1}: kind`}><select id={`ik_${k}`} name={`ik_${k}`} defaultValue=""><option value="">—</option>{Object.values(IssueKind).map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
                    <Field name={`id_${k}`} label="What happened"><input id={`id_${k}`} name={`id_${k}`} /></Field>
                    <Field name={`dl_${k}`} label="Working days lost"><input id={`dl_${k}`} name={`dl_${k}`} type="number" min="0" max="60" step="0.5" defaultValue="0" /></Field>
                  </div>
                ))}
              </div>
              <div className="row"><Submit>File report</Submit><span className="hint">A report cannot be edited once filed. A manager reviews it.</span></div>
            </ActionForm>
          </>
        )
      )}
    </>
  );
}
