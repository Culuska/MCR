import Link from "next/link";
import { scopeOf } from "@/lib/scope";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { subcontractFigures } from "@/lib/finance";
import { SubcontractForm } from "@/components/SubcontractForm";
import { Bar, Empty, Kpi, PageHead, Pill, Sample, clean } from "@/components/ui";
import { D, fmt, sum } from "@/lib/money";
import { label } from "@/lib/domain";

export const metadata = { title: "Subcontracts" };

export default async function Subcontracts() {
  const user = await requireRead("subcontracts");
  const rows = await subcontractFigures(undefined, await scopeOf(user));
  const live = rows.filter((r) => r.sub.status === "ACTIVE" || r.sub.status === "COMPLETED");
  const order = ["ACTIVE", "DRAFT", "COMPLETED"];
  rows.sort((a, b) => order.indexOf(a.sub.status) - order.indexOf(b.sub.status));
  return (
    <>
      <PageHead title="Subcontracts" sub="Work let to subcontractors, what has been certified and paid, and the retention held" />
      <section className="kpis">
        <Kpi label="Committed" value={fmt(sum(live.map((r) => r.revised)))} sub={`${live.length} subcontract${live.length === 1 ? "" : "s"} signed off`} />
        <Kpi label="Certified to date" value={fmt(sum(live.map((r) => r.certified)))} sub="Full value of approved work" />
        <Kpi label="Approved, not yet paid" value={fmt(sum(live.map((r) => r.unpaid)))} tone={sum(live.map((r) => r.unpaid)).greaterThan(0) ? "out" : undefined} sub="Net of retention" />
        <Kpi label="Retention held" value={fmt(sum(live.map((r) => r.retentionHeld)))} sub="Owed to subcontractors on release" />
      </section>
      {canWrite(user.role, "subcontracts") && (
        <details className="more" open={rows.length === 0}><summary>New subcontract</summary><div className="body"><SubcontractForm /></div></details>
      )}
      {rows.length === 0 ? <Empty title="No subcontracts yet">Draft a subcontract to track its value, payment certificates and retention.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Subcontract</th><th>Subcontractor</th><th>Project</th><th>Status</th><th className="r">Value</th><th style={{ width: 150 }}>Certified</th><th className="r">Retention held</th><th className="r">Unpaid</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.sub.id} className="link">
              <td><Link href={`/subcontracts/${r.sub.id}`}><b>{r.sub.number}</b></Link><br /><span className="small muted">{r.sub.scope.slice(0, 48)}{r.sub.scope.length > 48 ? "…" : ""}</span></td>
              <td>{clean(r.sub.supplier.name)} <Sample name={r.sub.supplier.name} /></td><td>{r.sub.project.code}</td>
              <td><Pill status="ACTIVE" text={label(r.sub.status)} />{r.behind.greaterThan(0) && <> <span className="pill warn">Behind</span></>}</td>
              <td className="r num">{fmt(r.revised)}</td>
              <td><Bar used={r.percent} /><span className="small muted num">{fmt(r.certified)} · {Math.round(r.percent)}%</span></td>
              <td className="r num">{D(r.retentionHeld).isZero() ? "—" : fmt(r.retentionHeld)}</td>
              <td className={`r num ${r.unpaid.greaterThan(0) ? "out" : ""}`}>{r.unpaid.greaterThan(0) ? fmt(r.unpaid) : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}
