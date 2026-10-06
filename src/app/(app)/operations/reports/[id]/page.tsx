import Link from "next/link";
import { requireRecord } from "@/lib/scope";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { siteDay } from "@/lib/site";
import { reviewReport } from "@/actions/operations";
import { AuditFor } from "@/components/RecordParts";
import { StepForm } from "@/components/ActionForm";
import { Kpi, PageHead, Pill, clean } from "@/components/ui";
import { Attachments } from "@/components/Attachments";
import { fmt, fmtDate } from "@/lib/money";
import { label } from "@/lib/domain";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("operations");
  const { id } = await params;
  await requireRecord(user, "siteReport", id);
  const r = await db.siteReport.findUnique({ where: { id }, include: { project: true, updates: { include: { task: true } }, issues: true } });
  if (!r) notFound();
  const [facts, users] = await Promise.all([siteDay(r.projectId, r.date), db.user.findMany({ select: { id: true, name: true } })]);
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const canReview = canWrite(user.role, "operations") && (user.role === "PROJECT_MANAGER" || user.role === "SUPER_ADMIN") && r.status !== "REVIEWED";

  return (
    <>
      <PageHead title={`${r.project.code} site report`} sub={`${fmtDate(r.date)} · ${clean(r.project.name)} · filed by ${name(r.createdById)}`}>
        <Pill status={r.status} />
        <Link className="btn" href="/operations?tab=reports">All reports</Link>
      </PageHead>

      <section className="kpis">
        <Kpi label="Workers on site" value={String(facts.workers)} sub={`${facts.absent} absent`} />
        <Kpi label="Machines and trucks" value={String(facts.equipment.length + facts.vehicles.length)} />
        <Kpi label="Material used" value={fmt(facts.materialValue)} />
        <Kpi label="Spent" value={fmt(facts.spend)} sub={`${facts.spendCount} expense${facts.spendCount === 1 ? "" : "s"}`} />
      </section>

      <section className="panel">
        <h2>Work done</h2><p style={{ margin: 0 }}>{r.workDone}</p>
        {r.weather && <span className="small muted">Weather: {r.weather}</span>}
        {r.planNext && <><b className="label">Planned next</b><p style={{ margin: 0 }}>{r.planNext}</p></>}
        {r.notes && <div className="notice">{r.notes}</div>}
      </section>

      <div className="grid2 even">
        <section className="panel"><h2>Task progress</h2>
          {r.updates.length === 0 ? <span className="muted">No task progress was reported.</span> : (
            <div className="tablewrap"><table><tbody>{r.updates.map((u) => <tr key={u.id}><td><b>{u.task.title}</b><br /><span className="small muted num">{u.task.number}</span></td><td className="r num">{u.completion}%</td><td className="small">{u.note ?? ""}</td></tr>)}</tbody></table></div>
          )}
        </section>
        <section className="panel"><h2>Problems</h2>
          {r.issues.length === 0 ? <span className="muted">None reported.</span> : (
            <div className="tablewrap"><table><tbody>{r.issues.map((i) => <tr key={i.id}><td className="num">{i.number}</td><td>{label(i.kind)}<br /><span className="small">{i.description}</span></td><td className="r num">{Number(i.daysLost) ? `${String(i.daysLost)} d` : ""}</td><td><Pill status={i.resolved ? "RESOLVED" : "OPEN"} /></td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>On site that day, from other records</h2>
        <div className="tablewrap"><table><tbody>
          <tr><td className="muted">Machines</td><td>{facts.equipment.length ? facts.equipment.map((e) => `${e.name.replace(" (sample)", "")} ${String(e.hours)} h`).join(", ") : "None logged"}</td></tr>
          <tr><td className="muted">Vehicles</td><td>{facts.vehicles.length ? facts.vehicles.map((v) => `${v.name.replace(" (sample)", "")} ${String(v.km)} km, ${v.trips} trips`).join(", ") : "None logged"}</td></tr>
          <tr><td className="muted">Material</td><td>{facts.materials.length ? facts.materials.map((m) => `${String(m.quantity)} ${m.unit} ${m.name.replace(" (sample)", "")}`).join(", ") : "Nothing issued"}</td></tr>
        </tbody></table></div>
      </section>

      <Attachments entity="SiteReport" id={r.id} user={user} title="Site photos" hint="Progress photos, measurements and anything that shows the state of the work." />

      <div className="row">
        {canReview && <StepForm action={reviewReport} id={r.id} to="REVIEW" label="Mark as reviewed" primary />}
        {r.status === "REVIEWED" && <span className="small muted">Reviewed by {name(r.reviewedById)}.</span>}
      </div>
      <section className="panel"><h2>History</h2><AuditFor entity="SiteReport" ids={[r.id]} /></section>
    </>
  );
}
