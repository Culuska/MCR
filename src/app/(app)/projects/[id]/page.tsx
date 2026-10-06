import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { projectCosting, subcontractFigures } from "@/lib/finance";
import { CATEGORY_LABEL } from "@/lib/domain";
import { fmt, fmtDate } from "@/lib/money";
import { Bar, Kpi, PageHead, Pill, Sample, clean } from "@/components/ui";

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("projects");
  const { id } = await params;
  const exists = await db.project.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound();

  const [c, expenses, invoices, subs] = await Promise.all([
    projectCosting(id),
    db.expense.findMany({ where: { projectId: id, status: { not: "VOID" } }, orderBy: { date: "desc" }, take: 12 }),
    db.invoice.findMany({ where: { projectId: id, status: { not: "VOID" } }, orderBy: { issueDate: "desc" } }),
    subcontractFigures(id),
  ]);
  const p = c.project;
  const over = c.lines.filter((l) => l.level >= 100 && !l.budget.isZero());

  return (
    <>
      <PageHead title={p.code} sub={`${clean(p.name)}${p.customer ? " · " + clean(p.customer.name) : ""}${p.location ? " · " + p.location : ""}`}>
        <Pill status={p.status} /> <Sample name={p.name} />
        {canWrite(user.role, "projects") && <Link className="btn" href={`/projects/${p.id}/edit`}>Edit project</Link>}
        <a className="btn" href={`/api/pdf/project/${p.id}`} target="_blank" rel="noreferrer">Statement PDF</a>
        {canWrite(user.role, "projects") && <DeleteButton kind="project" id={p.id} name={p.code} redirectTo="/projects" />}
        <Link className="btn" href={`/expenses/new?project=${p.id}`}>Add expense</Link>
      </PageHead>

      <section className="kpis">
        <Kpi label="Contract value" value={fmt(c.contract)} sub={`Invoiced ${fmt(c.invoiced)} · received ${fmt(c.received)}`} />
        <Kpi label="Cost to date" value={fmt(c.cost)} sub={`${Math.round(c.budgetUsed)}% of the ${fmt(c.budget)} budget`} />
        <Kpi label="Profit to date" value={fmt(c.actualProfit)} tone={c.actualProfit.isNegative() ? "out" : "in"} sub="Invoiced less cost" />
        <Kpi label="Expected profit" value={fmt(c.expectedProfit)} tone={c.expectedProfit.isNegative() ? "out" : "in"} sub={`Expected final cost ${fmt(c.expectedFinalCost)} at ${p.progress}% complete`} />
      </section>

      {over.length > 0 && <div className="alert bad"><span className="dot" />Over budget: {over.map((l) => CATEGORY_LABEL[l.category]).join(", ")}</div>}

      <section className="panel">
        <div className="panel-head"><h2>Budget against actual</h2><span className="small muted">Approved and paid expenses count as actual</span></div>
        {c.lines.length === 0 ? <span className="muted">No budget or spending yet. Edit the project to set a budget.</span> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Category</th><th className="r">Budget</th><th className="r">Spent</th><th className="r">Remaining</th><th style={{ width: 170 }}>Used</th></tr></thead>
            <tbody>{c.lines.map((l) => (
              <tr key={l.category}>
                <td>{CATEGORY_LABEL[l.category]} {l.level >= 80 && <span className={`pill ${l.level === 100 ? "bad" : "warn"}`}>{l.level === 100 ? "Over" : l.level + "%+"}</span>}</td>
                <td className="r num">{l.budget.isZero() ? <span className="muted">none</span> : fmt(l.budget)}</td>
                <td className="r num">{fmt(l.spent)}</td>
                <td className={`r num ${l.remaining.isNegative() ? "out" : ""}`}>{fmt(l.remaining)}</td>
                <td>{l.budget.isZero() ? <span className="small muted">Not budgeted</span> : <><Bar used={l.used} /><span className="small muted num">{Math.round(l.used)}%</span></>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td>Total</td><td className="r num">{fmt(c.budget)}</td><td className="r num">{fmt(c.cost)}</td><td className={`r num ${c.costVariance.isNegative() ? "out" : ""}`}>{fmt(c.costVariance)}</td><td /></tr></tfoot>
          </table></div>
        )}
      </section>

      {subs.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Subcontracts</h2><Link className="small" href="/subcontracts">All subcontracts</Link></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Subcontract</th><th>Subcontractor</th><th className="r">Value</th><th className="r">Certified</th><th className="r">Retention held</th></tr></thead>
            <tbody>{subs.map((x) => (
              <tr key={x.sub.id} className="link"><td><Link href={`/subcontracts/${x.sub.id}`}>{x.sub.number}</Link><br /><span className="small muted">{x.sub.scope.slice(0, 44)}</span></td><td>{clean(x.sub.supplier.name)}</td>
                <td className="r num">{fmt(x.revised)}</td><td className="r num">{fmt(x.certified)} <span className="small muted">({Math.round(x.percent)}%)</span></td><td className="r num">{x.retentionHeld.greaterThan(0) ? fmt(x.retentionHeld) : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <div className="grid2 even">
        <section className="panel">
          <div className="panel-head"><h2>Expenses</h2><Link className="small" href={`/expenses?project=${p.id}`}>View all</Link></div>
          {expenses.length === 0 ? <span className="muted">No expenses recorded.</span> : (
            <div className="tablewrap"><table><tbody>{expenses.map((e) => (
              <tr key={e.id} className="link">
                <td><Link href={`/expenses/${e.id}`}>{e.number}</Link><br /><span className="small muted">{fmtDate(e.date)}</span></td>
                <td>{e.description}<br /><span className="small muted">{CATEGORY_LABEL[e.category]}</span></td>
                <td className="r num">{fmt(e.amount)}</td><td><Pill status={e.status} /></td>
              </tr>
            ))}</tbody></table></div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Invoices</h2><Link className="small" href="/invoices">View all</Link></div>
          {invoices.length === 0 ? <span className="muted">No invoices raised.</span> : (
            <div className="tablewrap"><table><tbody>{invoices.map((i) => (
              <tr key={i.id} className="link">
                <td><Link href={`/invoices/${i.id}`}>{i.number}</Link><br /><span className="small muted">Due {fmtDate(i.dueDate)}</span></td>
                <td className="r num">{fmt(i.amount)}</td><td><Pill status={i.status} /></td>
              </tr>
            ))}</tbody></table></div>
          )}
        </section>
      </div>
    </>
  );
}
