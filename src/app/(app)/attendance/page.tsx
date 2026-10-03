import Link from "next/link";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { saveAttendance } from "@/actions/workforce";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Empty, Kpi, PageHead, Pill, clean } from "@/components/ui";
import { label } from "@/lib/domain";
import { fmtDate, toDateInput } from "@/lib/money";
import { AttendanceStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Attendance" };

export default async function Attendance({ searchParams }: { searchParams: Promise<{ date?: string; project?: string }> }) {
  const user = await requireRead("attendance");
  const sp = await searchParams;
  const dateStr = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : new Date().toISOString().slice(0, 10);
  const day = new Date(dateStr);
  const writer = canWrite(user.role, "attendance");

  // Names and positions only: pay rates are not selected, so supervisors never receive them.
  const [employees, records, projects, locks] = await Promise.all([
    db.employee.findMany({ where: { active: true }, select: { id: true, code: true, name: true, position: true }, orderBy: { code: "asc" } }),
    db.attendance.findMany({ where: { date: day } }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.payrollLine.findMany({ where: { run: { status: { not: "VOID" }, periodStart: { lte: day }, periodEnd: { gte: day } } }, select: { employeeId: true, run: { select: { number: true } } } }),
  ]);
  const byEmp = new Map(records.map((r) => [r.employeeId, r]));
  const locked = new Map(locks.map((l) => [l.employeeId, l.run.number]));
  const chosenProject = sp.project ?? records.find((r) => r.projectId)?.projectId ?? "";
  const count = (s: string) => records.filter((r) => r.status === s).length;
  const otTotal = records.reduce((a, r) => a + Number(r.overtimeHours), 0);

  return (
    <>
      <PageHead title="Attendance" sub="One sheet per day. Friday is the rest day, so nothing is expected on Fridays." />

      <form className="filters" action="/attendance">
        <input type="date" name="date" defaultValue={dateStr} max={toDateInput(new Date())} aria-label="Date" />
        <select name="project" defaultValue={chosenProject} aria-label="Project">
          <option value="">Office or yard (no project)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code} {clean(p.name)}</option>)}
        </select>
        <button className="btn" type="submit">Open sheet</button>
      </form>

      <section className="kpis">
        <Kpi label="Present" value={String(count("PRESENT"))} sub={fmtDate(day)} />
        <Kpi label="Half day" value={String(count("HALF_DAY"))} />
        <Kpi label="Absent or on leave" value={String(count("ABSENT") + count("LEAVE"))} />
        <Kpi label="Overtime hours" value={String(otTotal)} sub={`${records.length} of ${employees.length} recorded`} />
      </section>

      {employees.length === 0 ? <Empty title="No employees yet">Add employees first, then record their attendance here.</Empty> : (
        <ActionForm action={saveAttendance}>
          <input type="hidden" name="date" value={dateStr} />
          <input type="hidden" name="projectId" value={chosenProject} />
          <section className="panel">
            <div className="panel-head"><h2>Sheet for {fmtDate(day)}</h2><span className="small muted">Everyone below is charged to the project chosen above.</span></div>
            <div className="tablewrap"><table>
              <thead><tr><th>Employee</th><th>Position</th><th>Status</th><th>Overtime hours</th></tr></thead>
              <tbody>{employees.map((e) => {
                const r = byEmp.get(e.id);
                const lock = locked.get(e.id);
                return (
                  <tr key={e.id}>
                    <td><b>{e.name.replace(" (sample)", "")}</b><br /><span className="small muted num">{e.code}</span></td>
                    <td>{e.position}</td>
                    <td>
                      {r && <input type="hidden" name={`had_${e.id}`} value="1" />}
                      {lock ? <><Pill status={r?.status ?? "ABSENT"} text={r ? label(r.status) : "Not recorded"} /> <span className="small muted">Paid in {lock}</span></> : (
                        <select name={`s_${e.id}`} defaultValue={r?.status ?? ""} disabled={!writer} aria-label={`Status for ${e.name}`} style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }}>
                          <option value="">Not recorded</option>
                          {Object.values(AttendanceStatus).map((s) => <option key={s} value={s}>{label(s)}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{lock ? <span className="num">{r ? String(r.overtimeHours) : "—"}</span> : (
                      <input name={`ot_${e.id}`} type="number" min="0" max="16" step="0.5" defaultValue={r ? String(r.overtimeHours) : "0"} disabled={!writer} aria-label={`Overtime hours for ${e.name}`} style={{ width: 90, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }} />
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
          {writer ? <div className="row"><Submit>Save attendance</Submit><span className="hint">Blank rows are left unrecorded and are not paid.</span></div> : <span className="muted small">Your role can view attendance but not change it.</span>}
        </ActionForm>
      )}
      <p className="small muted" style={{ margin: 0 }}>Looking for pay? <Link href="/payroll">Payroll</Link> turns this attendance into wages.</p>
    </>
  );
}
