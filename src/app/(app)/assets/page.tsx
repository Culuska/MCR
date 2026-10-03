import Link from "next/link";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { assetCosting, fuelByProject } from "@/lib/finance";
import { logMaintenance, logUsage, createRental, closeRental, raiseRentalExpense } from "@/actions/assets";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { AssetForm } from "@/components/AssetForm";
import { Empty, Field, Kpi, PageHead, Pill, Tabs, clean } from "@/components/ui";
import { PERIOD_LABEL } from "@/lib/rentals";
import { label } from "@/lib/domain";
import { daysUntil, fmt, fmt2, fmtDate, sum, toDateInput } from "@/lib/money";

export const metadata = { title: "Equipment" };

const TABS = [
  { key: "register", label: "Register" }, { key: "usage", label: "Daily log" }, { key: "rentals", label: "Rentals" },
  { key: "maintenance", label: "Maintenance" }, { key: "costs", label: "Running costs" },
];
const unitOf = (kind: string) => (kind === "VEHICLE" ? "km" : "h");

export default async function Assets({ searchParams }: { searchParams: Promise<{ tab?: string; asset?: string }> }) {
  const user = await requireRead("assets");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "register";
  const writer = canWrite(user.role, "assets");
  const logger = canWrite(user.role, "usage");
  return (
    <>
      <PageHead title="Equipment" sub="Machines and vehicles: where they work, what they use and what they cost" />
      <Tabs current={tab} items={TABS.map((t) => ({ ...t, href: `/assets?tab=${t.key}` }))} />
      {tab === "register" && <Register writer={writer} />}
      {tab === "usage" && <Usage logger={logger} asset={sp.asset} />}
      {tab === "rentals" && <Rentals writer={writer} />}
      {tab === "maintenance" && <Maintenance writer={writer} />}
      {tab === "costs" && <Costs />}
    </>
  );
}

async function Register({ writer }: { writer: boolean }) {
  const rows = await assetCosting();
  const all = await db.asset.count({ where: { active: false } });
  return (
    <>
      {writer && <details className="more" open={rows.length === 0}><summary>Add a machine or vehicle</summary><div className="body"><AssetForm goTo="/assets" /></div></details>}
      {rows.length === 0 ? <Empty title="No equipment yet">Add your excavators, trucks and generators to track their work and running costs.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Asset</th><th>Type</th><th>Now</th><th>Next service</th><th>Insurance</th><th className="r">Cost to date</th></tr></thead>
          <tbody>{rows.map((r) => {
            const a = r.asset;
            return (
              <tr key={a.id} className="link">
                <td><Link href={`/assets/${a.id}`}><b>{a.name}</b></Link><br /><span className="small muted num">{a.code}{a.registration ? ` · ${a.registration}` : ""}</span></td>
                <td>{a.type}<br /><span className="small muted">{a.ownership === "HIRED" ? "Hired in" : "Owned"}</span></td>
                <td>{a.status === "AVAILABLE" && r.project ? <span className="pill info">{r.project.code}</span> : <Pill status={a.status} />}</td>
                <td className="num">{a.nextServiceDate ? <span className={daysUntil(a.nextServiceDate) < 14 ? "out" : ""}>{fmtDate(a.nextServiceDate)}</span> : "—"}</td>
                <td className="num">{a.insuranceExpiry ? fmtDate(a.insuranceExpiry) : "—"}</td>
                <td className="r num">{fmt(r.cost)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>{all > 0 && <span className="small muted">{all} retired or inactive asset{all === 1 ? "" : "s"} not shown.</span>}</section>
      )}
    </>
  );
}

async function Usage({ logger, asset }: { logger: boolean; asset?: string }) {
  const [assets, projects, logs] = await Promise.all([
    db.asset.findMany({ where: { active: true, status: { notIn: ["RETIRED"] } }, orderBy: { code: "asc" } }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.assetUsage.findMany({ where: { assetId: asset || undefined }, include: { asset: true, project: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 40 }),
  ]);
  return (
    <>
      {logger && assets.length > 0 && (
        <details className="more" open>
          <summary>Log a day&apos;s work</summary>
          <div className="body">
            <ActionForm action={logUsage} resetOnOk>
              <div className="fields three">
                <Field name="assetId" label="Machine or vehicle"><select id="assetId" name="assetId" required defaultValue={asset ?? ""}>
                  <option value="" disabled>Choose…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({unitOf(a.kind) === "km" ? "km" : "hours"})</option>)}
                </select></Field>
                <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
                <Field name="projectId" label="Project" hint="Leave blank to use the project it is assigned to."><select id="projectId" name="projectId" defaultValue="">
                  <option value="">Use its assignment</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                </select></Field>
                <Field name="startReading" label="Start reading" hint="Hour meter or odometer"><input id="startReading" name="startReading" type="number" step="0.1" min="0" required /></Field>
                <Field name="endReading" label="End reading"><input id="endReading" name="endReading" type="number" step="0.1" min="0" required /></Field>
                <Field name="fuelLitres" label="Fuel used (litres)"><input id="fuelLitres" name="fuelLitres" type="number" step="0.1" min="0" defaultValue="0" /></Field>
                <Field name="trips" label="Trips"><input id="trips" name="trips" type="number" min="0" step="1" defaultValue="0" /></Field>
                <Field name="operator" label="Driver or operator"><input id="operator" name="operator" /></Field>
                <Field name="purpose" label="Work done"><input id="purpose" name="purpose" placeholder="Excavating drainage trench" /></Field>
              </div>
              <div className="row"><Submit>Save entry</Submit><span className="hint">Readings only go up. A reading lower than the last one is refused.</span></div>
            </ActionForm>
          </div>
        </details>
      )}
      <form className="filters" action="/assets"><input type="hidden" name="tab" value="usage" />
        <select name="asset" defaultValue={asset ?? ""} aria-label="Asset"><option value="">All assets</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
      </form>
      {logs.length === 0 ? <Empty title="No work logged yet">Log each day&apos;s hours or kilometres so running costs can be worked out per hour and per kilometre.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Asset</th><th>Project</th><th className="r">Worked</th><th className="r">Fuel</th><th className="r">Trips</th><th>Operator</th><th>Work</th></tr></thead>
          <tbody>{logs.map((l) => (
            <tr key={l.id}>
              <td className="num">{fmtDate(l.date)}</td><td><Link href={`/assets/${l.assetId}`}>{l.asset.name}</Link></td><td>{l.project?.code ?? "—"}</td>
              <td className="r num">{String(l.units)} {unitOf(l.asset.kind)}</td><td className="r num">{Number(l.fuelLitres) ? `${l.fuelLitres} L` : "—"}</td><td className="r num">{l.trips || "—"}</td>
              <td>{l.operator ?? "—"}</td><td>{l.purpose ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}

async function Rentals({ writer }: { writer: boolean }) {
  const [assets, suppliers, projects, rentals] = await Promise.all([
    db.asset.findMany({ where: { active: true, status: { not: "RETIRED" } }, orderBy: { code: "asc" } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.rental.findMany({ include: { asset: true, supplier: true, project: true, expense: true }, orderBy: { startDate: "desc" } }),
  ]);
  const live = rentals.filter((r) => r.status === "ACTIVE");
  return (
    <>
      <section className="kpis">
        <Kpi label="Active hires" value={String(live.length)} sub={`${live.filter((r) => daysUntil(r.endDate) < 7).length} ending within a week`} />
        <Kpi label="Hire cost, active" value={fmt(sum(live.map((r) => r.total)))} sub="Before approval" />
        <Kpi label="Deposits held" value={fmt(sum(live.map((r) => r.deposit)))} sub="Refundable, not a cost" />
        <Kpi label="Not yet claimed" value={String(rentals.filter((r) => !r.expenseId && r.status !== "CANCELLED").length)} sub="No expense raised" />
      </section>
      {writer && (
        <details className="more">
          <summary>Record a hire</summary>
          <div className="body">
            <ActionForm action={createRental} resetOnOk>
              <div className="fields three">
                <Field name="assetId" label="Asset hired" hint="Add it in the Register first if it is not listed."><select id="assetId" name="assetId" required defaultValue="">
                  <option value="" disabled>Choose…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select></Field>
                <Field name="supplierId" label="Hired from"><select id="supplierId" name="supplierId" required defaultValue="">
                  <option value="" disabled>Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></Field>
                <Field name="projectId" label="Project"><select id="projectId" name="projectId" defaultValue=""><option value="">General (no project)</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
                <Field name="startDate" label="From"><input id="startDate" name="startDate" type="date" required /></Field>
                <Field name="endDate" label="To (last day)"><input id="endDate" name="endDate" type="date" required /></Field>
                <Field name="rateType" label="Rate per"><select id="rateType" name="rateType" defaultValue="DAILY"><option value="DAILY">Day</option><option value="WEEKLY">Week</option><option value="MONTHLY">Month (30 days)</option></select></Field>
                <Field name="rate" label="Rate (USD)"><input id="rate" name="rate" type="number" step="0.01" min="0.01" required /></Field>
                <Field name="deposit" label="Deposit (USD)"><input id="deposit" name="deposit" type="number" step="0.01" min="0" defaultValue="0" /></Field>
                <Field name="extraCharges" label="Extra charges (USD)" hint="Delivery, fuel, damage."><input id="extraCharges" name="extraCharges" type="number" step="0.01" min="0" defaultValue="0" /></Field>
              </div>
              <div className="row"><Submit>Record hire</Submit><span className="hint">The total is worked out from the dates and rate. Part of a week or month counts as a full one.</span></div>
            </ActionForm>
          </div>
        </details>
      )}
      {rentals.length === 0 ? <Empty title="No hires recorded">Record equipment and trucks you hire in, and the cost flows to the project.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Hire</th><th>Asset</th><th>Supplier</th><th>Period</th><th className="r">Rate</th><th className="r">Total</th><th>Status</th><th>Cost</th></tr></thead>
          <tbody>{rentals.map((r) => {
            const ending = r.status === "ACTIVE" && daysUntil(r.endDate) < 7;
            return (
              <tr key={r.id}>
                <td className="num">{r.number}</td><td>{r.asset.name}</td><td>{r.supplier.name}<br /><span className="small muted">{r.project?.code ?? "No project"}</span></td>
                <td className="num">{fmtDate(r.startDate)}<br />to {fmtDate(r.endDate)}</td>
                <td className="r num">{fmt2(r.rate)}<br /><span className="small muted">per {PERIOD_LABEL[r.rateType]}</span></td>
                <td className="r num">{fmt2(r.total)}{Number(r.deposit) > 0 && <><br /><span className="small muted">deposit {fmt(r.deposit)}</span></>}</td>
                <td><Pill status={r.status} />{ending && <><br /><span className={`pill ${daysUntil(r.endDate) < 0 ? "bad" : "warn"}`}>{daysUntil(r.endDate) < 0 ? "Past end date" : "Ends soon"}</span></>}</td>
                <td>
                  {r.expense ? <Link href={`/expenses/${r.expense.id}`}>{r.expense.number}</Link> : writer && r.status !== "CANCELLED" ? <StepForm action={raiseRentalExpense} id={r.id} to="RAISE" label="Raise expense" /> : "—"}
                  {writer && r.status === "ACTIVE" && <div className="row" style={{ marginTop: 6 }}><StepForm action={closeRental} id={r.id} to="END" label="Close" />{!r.expenseId && <StepForm action={closeRental} id={r.id} to="CANCEL" label="Cancel" danger />}</div>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div></section>
      )}
    </>
  );
}

async function Maintenance({ writer }: { writer: boolean }) {
  const [assets, projects, records] = await Promise.all([
    db.asset.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.maintenanceRecord.findMany({ include: { asset: true, expense: true }, orderBy: { date: "desc" }, take: 40 }),
  ]);
  const due = assets.filter((a) => a.nextServiceDate && daysUntil(a.nextServiceDate) < 30 && a.status !== "RETIRED").sort((a, b) => a.nextServiceDate!.getTime() - b.nextServiceDate!.getTime());
  return (
    <>
      {due.length > 0 && (
        <section className="panel"><h2>Service due in the next 30 days</h2>
          <div className="tablewrap"><table><tbody>{due.map((a) => (
            <tr key={a.id}><td><Link href={`/assets/${a.id}`}>{a.name}</Link></td><td className="num">{fmtDate(a.nextServiceDate)}</td><td>{daysUntil(a.nextServiceDate!) < 0 ? <span className="pill bad">Overdue</span> : <span className="pill warn">Due soon</span>}</td></tr>
          ))}</tbody></table></div></section>
      )}
      {writer && assets.length > 0 && (
        <details className="more">
          <summary>Log a service or repair</summary>
          <div className="body">
            <ActionForm action={logMaintenance} resetOnOk>
              <div className="fields three">
                <Field name="assetId" label="Asset"><select id="assetId" name="assetId" required defaultValue=""><option value="" disabled>Choose…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
                <Field name="kind" label="Type"><select id="kind" name="kind" defaultValue="SERVICE"><option value="SERVICE">Routine service</option><option value="REPAIR">Repair</option></select></Field>
                <Field name="description" label="Work done" wide><input id="description" name="description" required minLength={3} placeholder="Engine oil and filters, 500-hour service" /></Field>
                <Field name="cost" label="Cost (USD)" hint="A draft expense is raised for any cost."><input id="cost" name="cost" type="number" step="0.01" min="0" defaultValue="0" /></Field>
                <Field name="projectId" label="Charge to project"><select id="projectId" name="projectId" defaultValue=""><option value="">General overhead</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
                <Field name="nextServiceDate" label="Next service due"><input id="nextServiceDate" name="nextServiceDate" type="date" /></Field>
              </div>
              <label className="row small"><input type="checkbox" name="underRepair" /> The asset is out of action until repaired</label>
              <div className="row"><Submit>Save record</Submit></div>
            </ActionForm>
          </div>
        </details>
      )}
      {records.length === 0 ? <Empty title="No maintenance logged">Record services and repairs to keep service dates and costs in one place.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Asset</th><th>Type</th><th>Work</th><th className="r">Cost</th><th>Expense</th></tr></thead>
          <tbody>{records.map((m) => (
            <tr key={m.id}><td className="num">{fmtDate(m.date)}</td><td><Link href={`/assets/${m.assetId}`}>{m.asset.name}</Link></td><td>{label(m.kind)}</td><td>{m.description}</td>
              <td className="r num">{Number(m.cost) ? fmt2(m.cost) : "—"}</td><td>{m.expense ? <Link href={`/expenses/${m.expense.id}`}>{m.expense.number}</Link> : "—"}</td></tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}

async function Costs() {
  const [rows, fuel] = await Promise.all([assetCosting(), fuelByProject()]);
  const worked = rows.filter((r) => r.cost.greaterThan(0) || r.units.greaterThan(0));
  const total = sum(rows.map((r) => r.cost));
  return (
    <>
      <section className="kpis">
        <Kpi label="Running cost, all assets" value={fmt(total)} sub="Approved and paid costs tagged to an asset" />
        <Kpi label="Hire" value={fmt(sum(rows.map((r) => r.hire)))} />
        <Kpi label="Fuel" value={fmt(sum(rows.map((r) => r.fuel)))} />
        <Kpi label="Maintenance" value={fmt(sum(rows.map((r) => r.maintenance)))} />
      </section>
      {worked.length === 0 ? <Empty title="No costs tagged yet">Choose a machine or vehicle when you enter a fuel, repair or hire expense, and it shows up here.</Empty> : (
        <section className="panel"><div className="panel-head"><h2>Cost per asset</h2><span className="small muted">Highest first</span></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Asset</th><th className="r">Fuel</th><th className="r">Hire</th><th className="r">Maintenance</th><th className="r">Total</th><th className="r">Worked</th><th className="r">Cost per unit</th><th className="r">Fuel per unit</th></tr></thead>
            <tbody>{[...worked].sort((a, b) => b.cost.comparedTo(a.cost)).map((r) => (
              <tr key={r.asset.id} className="link">
                <td><Link href={`/assets/${r.asset.id}`}>{r.asset.name}</Link></td>
                <td className="r num">{fmt(r.fuel)}</td><td className="r num">{fmt(r.hire)}</td><td className="r num">{fmt(r.maintenance)}</td><td className="r num"><b>{fmt(r.cost)}</b></td>
                <td className="r num">{r.units.isZero() ? "—" : `${r.units} ${unitOf(r.asset.kind)}`}</td>
                <td className="r num">{r.costPerUnit ? `${fmt2(r.costPerUnit)} /${unitOf(r.asset.kind)}` : "—"}</td>
                <td className="r num">{r.litresPerUnit ? `${r.litresPerUnit.toFixed(2)} L/${unitOf(r.asset.kind)}` : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      {fuel.length > 0 && (
        <section className="panel"><h2>Fuel used by project</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Project</th><th className="r">Litres</th><th className="r">Hours or km worked</th></tr></thead>
            <tbody>{fuel.map((f) => <tr key={f.project?.id ?? "none"}><td>{f.project ? `${f.project.code} ${clean(f.project.name)}` : "No project"}</td><td className="r num">{f.litres.toFixed(0)} L</td><td className="r num">{String(f.units)}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
