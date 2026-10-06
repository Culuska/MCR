import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { stockSummary } from "@/lib/finance";
import { isLow } from "@/lib/stock";
import { adjustStock, createPurchaseOrder, issueMaterial, openingStock, saveMaterial, voidIssue } from "@/actions/stock";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { Empty, Field, Kpi, PageHead, Pill, Tabs, clean } from "@/components/ui";
import { D, fmt, fmt2, fmtDate, sum, toDateInput } from "@/lib/money";
import { label } from "@/lib/domain";

export const metadata = { title: "Materials" };

const TABS = [{ key: "stock", label: "Stock" }, { key: "movements", label: "Movements" }, { key: "orders", label: "Purchase orders" }];
const CATEGORIES = ["Cement", "Sand and gravel", "Blocks and bricks", "Steel and rebar", "Timber", "Pipes and fittings", "Electrical", "Paint and finishes", "Fuel", "Other"];

export default async function Materials({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const user = await requireRead("stock");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "stock";
  return (
    <>
      <PageHead title="Materials" sub="What is in the store, what it cost, and where it was used" />
      <Tabs current={tab} items={TABS.map((t) => ({ ...t, href: `/materials?tab=${t.key}` }))} />
      {tab === "stock" && <Stock role={user.role} edit={sp.edit} />}
      {tab === "movements" && <Movements role={user.role} />}
      {tab === "orders" && <Orders role={user.role} />}
    </>
  );
}

async function Stock({ role, edit }: { role: Parameters<typeof canWrite>[0]; edit?: string }) {
  const writer = canWrite(role, "stock");
  const isFinance = APPROVERS.includes(role);
  const [s, projects] = await Promise.all([stockSummary(), db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } })]);
  const low = s.rows.filter((r) => isLow(r.onHand, r.reorderLevel));
  const editing = edit ? s.rows.find((r) => r.id === edit) : undefined;

  return (
    <>
      <section className="kpis">
        <Kpi label="Stock value" value={fmt(s.value)} sub={`${s.rows.length} materials at average cost`} />
        <Kpi label="Running low" value={String(low.length)} tone={low.length ? "out" : undefined} sub={low.length ? low.slice(0, 2).map((m) => m.name).join(", ") : "Nothing under its reorder level"} />
        <Kpi label="Bills awaiting approval" value={fmt(s.awaiting)} sub="Delivered, waiting for finance to approve" />
        <Kpi label="Ledger Inventory" value={fmt(s.inLedger)} sub={s.difference.abs().lessThan(1) ? "Matches the stock list" : `Differs from the list by ${fmt2(s.difference)}`} />
      </section>

      {writer && (
        <div className="grid2 even">
          <details className="more">
            <summary>Use material on a project</summary>
            <div className="body">
              <ActionForm action={issueMaterial} resetOnOk>
                <div className="fields">
                  <Field name="materialId" label="Material"><select id="materialId" name="materialId" required defaultValue=""><option value="" disabled>Choose…</option>
                    {s.rows.filter((r) => D(r.onHand).greaterThan(0)).map((r) => <option key={r.id} value={r.id}>{r.name} ({String(r.onHand)} {r.unit} in stock)</option>)}</select></Field>
                  <Field name="projectId" label="Project"><select id="projectId" name="projectId" required defaultValue=""><option value="" disabled>Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {clean(p.name)}</option>)}</select></Field>
                  <Field name="quantity" label="Quantity used"><input id="quantity" name="quantity" type="number" step="0.001" min="0.001" required /></Field>
                  <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
                  <Field name="note" label="Note" wide><input id="note" name="note" placeholder="Foundation, block B" /></Field>
                </div>
                <div className="row"><Submit>Issue to project</Submit><span className="hint">The cost goes to the project at the average cost of the stock.</span></div>
              </ActionForm>
            </div>
          </details>
          <details className="more" open={!!editing}>
            <summary>{editing ? `Edit ${editing.name}` : "Add a material"}</summary>
            <div className="body">
              <ActionForm key={editing?.id ?? "new"} action={saveMaterial} goTo="/materials" resetOnOk>
                {editing && <input type="hidden" name="id" value={editing.id} />}
                <div className="fields">
                  <Field name="name" label="Name"><input id="name" name="name" required defaultValue={editing?.name} placeholder="Portland cement 50kg" /></Field>
                  <Field name="category" label="Category"><input id="category" name="category" list="mat-cats" required defaultValue={editing?.category} /><datalist id="mat-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></Field>
                  <Field name="unit" label="Counted in"><input id="unit" name="unit" required defaultValue={editing?.unit} placeholder="bag, tonne, m3, piece" /></Field>
                  <Field name="reorderLevel" label="Reorder when stock is at or below"><input id="reorderLevel" name="reorderLevel" type="number" step="0.001" min="0" defaultValue={editing ? String(editing.reorderLevel) : "0"} /></Field>
                  {editing && <Field name="active" label="Status"><select id="active" name="active" defaultValue="on"><option value="on">In use</option><option value="off">Retired</option></select></Field>}
                </div>
                <div className="row"><Submit>{editing ? "Save changes" : "Add material"}</Submit></div>
              </ActionForm>
            </div>
          </details>
          <details className="more">
            <summary>Correct a stock count</summary>
            <div className="body">
              <ActionForm action={adjustStock} resetOnOk>
                <div className="fields">
                  <Field name="materialId" label="Material"><select id="adj-materialId" name="materialId" required defaultValue=""><option value="" disabled>Choose…</option>{s.rows.map((r) => <option key={r.id} value={r.id}>{r.name} ({String(r.onHand)} {r.unit})</option>)}</select></Field>
                  <Field name="change" label="Change in quantity" hint="Use a minus sign for a shortage, for example -12."><input id="change" name="change" type="number" step="0.001" required /></Field>
                  <Field name="date" label="Date"><input id="adj-date" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
                  <Field name="reason" label="Reason"><input id="reason" name="reason" required minLength={3} placeholder="Stock count found 12 bags fewer" /></Field>
                </div>
                <div className="row"><Submit>Save correction</Submit><span className="hint">Valued at the average cost and posted to the ledger. Corrections over $500 need finance staff.</span></div>
              </ActionForm>
            </div>
          </details>
          {isFinance && (
            <details className="more">
              <summary>Enter opening stock</summary>
              <div className="body">
                <ActionForm action={openingStock} resetOnOk>
                  <div className="fields">
                    <Field name="materialId" label="Material"><select id="open-materialId" name="materialId" required defaultValue=""><option value="" disabled>Choose…</option>{s.rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
                    <Field name="quantity" label="Quantity on the shelf"><input id="open-quantity" name="quantity" type="number" step="0.001" min="0.001" required /></Field>
                    <Field name="unitCost" label="Cost per unit (USD)"><input id="unitCost" name="unitCost" type="number" step="0.0001" min="0.0001" required /></Field>
                    <Field name="date" label="As at"><input id="open-date" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
                  </div>
                  <div className="row"><Submit>Add opening stock</Submit><span className="hint">For stock that was already on hand before using this system.</span></div>
                </ActionForm>
              </div>
            </details>
          )}
        </div>
      )}

      {s.rows.length === 0 ? <Empty title="No materials yet">Add the materials you buy, then raise a purchase order to bring stock in.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Material</th><th>Category</th><th className="r">In stock</th><th className="r">Average cost</th><th className="r">Value</th><th className="r">Reorder at</th><th /></tr></thead>
          <tbody>{s.rows.map((r) => {
            const lowStock = isLow(r.onHand, r.reorderLevel);
            return (
              <tr key={r.id}>
                <td><b>{r.name}</b><br /><span className="small muted num">{r.code}</span></td><td>{r.category}</td>
                <td className="r num">{String(r.onHand)} {r.unit} {lowStock && <span className={`pill ${D(r.onHand).isZero() ? "bad" : "warn"}`}>{D(r.onHand).isZero() ? "Out" : "Low"}</span>}</td>
                <td className="r num">{D(r.avgCost).isZero() ? "—" : fmt2(r.avgCost)}</td><td className="r num">{fmt(r.value)}</td>
                <td className="r num">{D(r.reorderLevel).isZero() ? "—" : String(r.reorderLevel)}</td>
                <td>{writer && <div className="row"><Link className="small" href={`/materials?edit=${r.id}`}>Edit</Link><DeleteButton kind="material" id={r.id} name={r.name} /></div>}</td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={4}>Total stock value</td><td className="r num">{fmt(s.value)}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
        <div className="notice small" style={{ color: "var(--muted)" }}>Stock list {fmt2(s.value)} · ledger Inventory {fmt2(s.inLedger)} · difference {fmt2(s.difference)}. A small difference is rounding. Bills awaiting approval ({fmt2(s.awaiting)}) are already counted, held as goods received and not yet invoiced.</div>
        </section>
      )}
    </>
  );
}

async function Movements({ role }: { role: Parameters<typeof canWrite>[0] }) {
  const isFinance = APPROVERS.includes(role);
  const rows = await db.stockMovement.findMany({ include: { material: true, project: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 60 });
  if (!rows.length) return <Empty title="No stock movements yet">Receipts, issues to projects and corrections will be listed here.</Empty>;
  return (
    <section className="panel"><div className="tablewrap"><table>
      <thead><tr><th>Date</th><th>Material</th><th>Type</th><th className="r">Quantity</th><th className="r">Unit cost</th><th className="r">Value</th><th>Project</th><th>Detail</th><th /></tr></thead>
      <tbody>{rows.map((m) => (
        <tr key={m.id} style={m.voided ? { opacity: 0.55 } : undefined}>
          <td className="num">{fmtDate(m.date)}</td><td>{m.material.name}</td><td><Pill status="ACTIVE" text={label(m.type)} /></td>
          <td className={`r num ${D(m.quantity).isNegative() ? "out" : "in"}`}>{D(m.quantity).isNegative() ? "" : "+"}{String(m.quantity)} {m.material.unit}</td>
          <td className="r num">{fmt2(m.unitCost)}</td><td className="r num" style={m.voided ? { textDecoration: "line-through" } : undefined}>{fmt2(m.value)}</td>
          <td>{m.project?.code ?? "—"}</td><td className="small">{m.reference ?? m.note ?? ""}</td>
          <td>{m.voided ? <span className="pill bad">Void</span> : isFinance && m.type === "ISSUE" && <StepForm action={voidIssue} id={m.id} to="VOID" label="Void" ask="Reason" danger />}</td>
        </tr>
      ))}</tbody>
    </table></div></section>
  );
}

async function Orders({ role }: { role: Parameters<typeof canWrite>[0] }) {
  const writer = canWrite(role, "purchasing");
  const [orders, suppliers, projects, materials] = await Promise.all([
    db.purchaseOrder.findMany({ include: { supplier: true, project: true, lines: true }, orderBy: [{ orderDate: "desc" }, { number: "desc" }] }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { code: "asc" } }),
    db.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const open = orders.filter((o) => o.status === "ORDERED" || o.status === "PART_RECEIVED");
  const totalOf = (o: (typeof orders)[number]) => sum(o.lines.map((l) => D(l.quantity).times(l.unitPrice)));
  return (
    <>
      <section className="kpis">
        <Kpi label="Open orders" value={String(open.length)} sub="Ordered, not fully received" />
        <Kpi label="On order, value" value={fmt(sum(open.map((o) => sum(o.lines.map((l) => D(l.quantity).minus(l.received).times(l.unitPrice))))))} sub="Still to be delivered" />
        <Kpi label="Drafts" value={String(orders.filter((o) => o.status === "DRAFT").length)} sub="Not yet sent" />
        <Kpi label="Orders, all" value={String(orders.length)} />
      </section>
      {writer && (
        <details className="more" open={orders.length === 0}>
          <summary>New purchase order</summary>
          <div className="body">
            {materials.length === 0 ? <span className="muted">Add materials on the Stock tab first.</span> : (
              <ActionForm action={createPurchaseOrder} goToPrefix="/materials/orders/">
                <div className="fields three">
                  <Field name="supplierId" label="Supplier"><select id="supplierId" name="supplierId" required defaultValue=""><option value="" disabled>Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                  <Field name="projectId" label="For project" hint="Optional. Cost lands on a project only when material is used."><select id="projectId" name="projectId" defaultValue=""><option value="">General stock</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
                  <Field name="orderDate" label="Order date"><input id="orderDate" name="orderDate" type="date" required defaultValue={toDateInput(new Date())} /></Field>
                  <Field name="expectedDate" label="Expected delivery"><input id="expectedDate" name="expectedDate" type="date" /></Field>
                  <Field name="notes" label="Notes" wide><input id="notes" name="notes" /></Field>
                </div>
                <div className="tablewrap"><table>
                  <thead><tr><th>Material</th><th style={{ width: 130 }}>Quantity</th><th style={{ width: 150 }}>Price per unit</th></tr></thead>
                  <tbody>{[0, 1, 2, 3, 4, 5].map((i) => (
                    <tr key={i}>
                      <td><select name={`m_${i}`} aria-label={`Line ${i + 1} material`} defaultValue="" style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }}><option value="">—</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></td>
                      <td><input name={`q_${i}`} type="number" step="0.001" min="0" aria-label={`Line ${i + 1} quantity`} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }} /></td>
                      <td><input name={`p_${i}`} type="number" step="0.0001" min="0" aria-label={`Line ${i + 1} price`} style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }} /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
                <div className="row"><Submit>Create order</Submit><span className="hint">Leave unused lines blank.</span></div>
              </ActionForm>
            )}
          </div>
        </details>
      )}
      {orders.length === 0 ? <Empty title="No purchase orders yet">Order materials from a supplier, then record the delivery to bring them into stock.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Order</th><th>Supplier</th><th>Ordered</th><th>Expected</th><th>Status</th><th className="r">Lines</th><th className="r">Value</th></tr></thead>
          <tbody>{orders.map((o) => (
            <tr key={o.id} className="link">
              <td><Link href={`/materials/orders/${o.id}`}><b>{o.number}</b></Link></td><td>{o.supplier.name}</td><td className="num">{fmtDate(o.orderDate)}</td><td className="num">{fmtDate(o.expectedDate)}</td>
              <td><Pill status="ACTIVE" text={label(o.status)} /></td><td className="r num">{o.lines.length}</td><td className="r num">{fmt(totalOf(o))}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}
