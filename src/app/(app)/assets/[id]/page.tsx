import Link from "next/link";
import { currentScope, onProject, projectWhere } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { assetCosting } from "@/lib/finance";
import { assignAsset, releaseAsset } from "@/actions/assets";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AssetForm } from "@/components/AssetForm";
import { AuditFor } from "@/components/RecordParts";
import { CATEGORY_LABEL } from "@/lib/domain";
import { Field, Kpi, PageHead, Pill, clean } from "@/components/ui";
import { daysUntil, fmt, fmt2, fmtDate, toDateInput } from "@/lib/money";

export default async function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("assets");
  const { id } = await params;
  const asset = await db.asset.findUnique({ where: { id } });
  if (!asset) notFound();

  const writer = canWrite(user.role, "assets");
  const unit = asset.kind === "VEHICLE" ? "km" : "h";
  const [costing, assignments, usage, maintenance, rentals, expenses, projects] = await Promise.all([
    currentScope().then((sc) => assetCosting(sc)),
    db.assetAssignment.findMany({ where: { assetId: id, ...onProject(await currentScope()) }, include: { project: true }, orderBy: { startDate: "desc" } }),
    db.assetUsage.findMany({ where: { assetId: id, ...onProject(await currentScope()) }, include: { project: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 15 }),
    db.maintenanceRecord.findMany({ where: { assetId: id }, orderBy: { date: "desc" }, take: 10 }),
    db.rental.findMany({ where: { assetId: id, ...onProject(await currentScope()) }, include: { supplier: true }, orderBy: { startDate: "desc" } }),
    db.expense.findMany({ where: { assetId: id, status: { not: "VOID" }, ...onProject(await currentScope()) }, orderBy: { date: "desc" }, take: 12 }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, ...projectWhere(await currentScope()) }, orderBy: { code: "asc" } }),
  ]);
  const c = costing.find((r) => r.asset.id === id);
  const current = assignments.find((a) => !a.endDate || daysUntil(a.endDate) >= 0);

  return (
    <>
      <PageHead title={asset.name} sub={`${asset.code} · ${asset.type}${asset.registration ? " · " + asset.registration : ""} · ${asset.ownership === "HIRED" ? "Hired in" : "Owned"}`}>
        <Pill status={asset.status} />
        <Link className="btn" href="/assets">All equipment</Link>
      </PageHead>

      <section className="kpis">
        <Kpi label="Running cost" value={fmt(c?.cost)} sub={`Fuel ${fmt(c?.fuel)} · hire ${fmt(c?.hire)} · repairs ${fmt(c?.maintenance)}`} />
        <Kpi label="Worked" value={c && !c.units.isZero() ? `${c.units} ${unit}` : "—"} sub={`${c?.trips ?? 0} trips logged`} />
        <Kpi label="Cost per unit" value={c?.costPerUnit ? `${fmt2(c.costPerUnit)}/${unit}` : "—"} sub="Running cost divided by work logged" />
        <Kpi label="Fuel use" value={c?.litresPerUnit ? `${c.litresPerUnit.toFixed(2)} L/${unit}` : "—"} sub={c ? `${c.litres.toFixed(0)} litres logged` : undefined} />
      </section>

      <div className="grid2 even">
        <section className="panel">
          <h2>Where it is working</h2>
          {current ? <div className="notice">On <Link href={`/projects/${current.projectId}`}>{current.project.code} {clean(current.project.name)}</Link> since {fmtDate(current.startDate)}{current.endDate ? `, until ${fmtDate(current.endDate)}` : ""}.</div> : <span className="muted">Not assigned to a project today.</span>}
          {writer && (
            <ActionForm action={assignAsset} resetOnOk>
              <input type="hidden" name="assetId" value={asset.id} />
              <div className="fields three">
                <Field name="projectId" label="Assign to"><select id="projectId" name="projectId" required defaultValue=""><option value="" disabled>Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
                <Field name="startDate" label="From"><input id="startDate" name="startDate" type="date" required defaultValue={toDateInput(new Date())} /></Field>
                <Field name="endDate" label="Until (optional)"><input id="endDate" name="endDate" type="date" /></Field>
              </div>
              <div className="row"><Submit>Assign</Submit></div>
            </ActionForm>
          )}
          {assignments.length > 0 && (
            <div className="tablewrap"><table>
              <thead><tr><th>Project</th><th>From</th><th>To</th><th /></tr></thead>
              <tbody>{assignments.map((a) => (
                <tr key={a.id}><td>{a.project.code}</td><td className="num">{fmtDate(a.startDate)}</td><td className="num">{a.endDate ? fmtDate(a.endDate) : "open"}</td>
                  <td>{writer && !a.endDate && (
                    <ActionForm action={releaseAsset} className="inline-form"><input type="hidden" name="id" value={a.id} />
                      <input name="endDate" type="date" required defaultValue={toDateInput(new Date())} aria-label="Release date" style={{ padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }} />
                      <Submit className="btn sm">Release</Submit></ActionForm>
                  )}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        <section className="panel">
          <h2>Details</h2>
          <div className="tablewrap"><table><tbody>
            <tr><td className="muted">Fuel</td><td>{asset.fuelType ?? "—"}</td></tr>
            <tr><td className="muted">Driver or operator</td><td>{asset.driver ?? "—"}</td></tr>
            <tr><td className="muted">Purchase price</td><td className="num">{asset.purchasePrice ? fmt(asset.purchasePrice) : "—"}</td></tr>
            <tr><td className="muted">Next service</td><td className="num">{fmtDate(asset.nextServiceDate)}</td></tr>
            <tr><td className="muted">Insurance expires</td><td className="num">{fmtDate(asset.insuranceExpiry)}</td></tr>
            {asset.notes && <tr><td className="muted">Notes</td><td>{asset.notes}</td></tr>}
          </tbody></table></div>
          {writer && <div style={{ marginBottom: 8 }}><DeleteButton kind="asset" id={asset.id} name={asset.name} redirectTo="/assets" /></div>}
          {writer && <details className="more"><summary>Edit details</summary><div className="body"><AssetForm asset={asset} goTo={`/assets/${asset.id}`} /></div></details>}
        </section>
      </div>

      <div className="grid2 even">
        <section className="panel"><div className="panel-head"><h2>Recent work</h2><Link className="small" href={`/assets?tab=usage&asset=${asset.id}`}>Log work</Link></div>
          {usage.length === 0 ? <span className="muted">Nothing logged yet.</span> : (
            <div className="tablewrap"><table><tbody>{usage.map((u) => (
              <tr key={u.id}><td className="num">{fmtDate(u.date)}</td><td>{u.project?.code ?? "—"}</td><td className="r num">{String(u.units)} {unit}</td><td className="r num">{Number(u.fuelLitres) ? `${u.fuelLitres} L` : ""}</td></tr>
            ))}</tbody></table></div>
          )}
        </section>
        <section className="panel"><h2>Costs charged to this asset</h2>
          {expenses.length === 0 ? <span className="muted">No expenses are tagged to this asset yet.</span> : (
            <div className="tablewrap"><table><tbody>{expenses.map((e) => (
              <tr key={e.id} className="link"><td><Link href={`/expenses/${e.id}`}>{e.number}</Link><br /><span className="small muted">{fmtDate(e.date)}</span></td><td>{e.description}<br /><span className="small muted">{CATEGORY_LABEL[e.category]}</span></td><td className="r num">{fmt(e.amount)}</td><td><Pill status={e.status} /></td></tr>
            ))}</tbody></table></div>
          )}
        </section>
      </div>

      {(maintenance.length > 0 || rentals.length > 0) && (
        <div className="grid2 even">
          <section className="panel"><h2>Maintenance</h2>
            {maintenance.length === 0 ? <span className="muted">None logged.</span> : <div className="tablewrap"><table><tbody>{maintenance.map((m) => (
              <tr key={m.id}><td className="num">{fmtDate(m.date)}</td><td>{m.description}</td><td className="r num">{Number(m.cost) ? fmt2(m.cost) : "—"}</td></tr>
            ))}</tbody></table></div>}
          </section>
          <section className="panel"><h2>Hire</h2>
            {rentals.length === 0 ? <span className="muted">Not hired.</span> : <div className="tablewrap"><table><tbody>{rentals.map((r) => (
              <tr key={r.id}><td className="num">{r.number}</td><td>{r.supplier.name}<br /><span className="small muted">{fmtDate(r.startDate)} to {fmtDate(r.endDate)}</span></td><td className="r num">{fmt2(r.total)}</td><td><Pill status={r.status} /></td></tr>
            ))}</tbody></table></div>}
          </section>
        </div>
      )}

      <section className="panel"><h2>History</h2><AuditFor entity="Asset" ids={[asset.id]} /></section>
    </>
  );
}
