import Link from "next/link";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { alerts, allProjectsSummary, cashFlow, companyPosition, expenseBreakdown } from "@/lib/finance";
import { CATEGORY_LABEL } from "@/lib/domain";
import { fmt, fmtDate, pct } from "@/lib/money";
import { Bar, Empty, Kpi, PageHead, Pill, clean } from "@/components/ui";
import { CashFlowChart } from "@/components/charts";

export const metadata = { title: "Overview" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireRead("dashboard");
  const { denied } = await searchParams;
  const [pos, flow, projects, notes, breakdown, pending] = await Promise.all([
    companyPosition(), cashFlow(6), allProjectsSummary(), alerts(), expenseBreakdown(),
    db.expense.findMany({ where: { status: { in: ["SUBMITTED", "DRAFT"] } }, include: { project: true }, orderBy: { date: "desc" }, take: 5 }),
  ]);
  const active = projects.filter((p) => p.project.status === "ACTIVE");
  const month = flow[flow.length - 1];
  const topCost = breakdown[0]?.total;

  return (
    <>
      <PageHead title="Overview" sub={`${active.length} active project${active.length === 1 ? "" : "s"} · figures from the ledger, all in USD`}>
        <Link className="btn" href="/expenses/new">New expense</Link>
        <Link className="btn primary" href="/invoices/new">New invoice</Link>
      </PageHead>

      {denied && <div className="notice error">Your role does not have access to {denied}.</div>}

      {notes.length > 0 && (
        <section className="alerts" aria-label="Needs attention">
          {notes.slice(0, 5).map((n, i) => (
            <Link key={i} href={n.href} className={`alert ${n.tone}`} style={{ textDecoration: "none", color: "inherit" }}><span className="dot" />{n.text}</Link>
          ))}
          {notes.length > 5 && (
            <details className="more">
              <summary>Show {notes.length - 5} more</summary>
              <div className="body alerts">
                {notes.slice(5).map((n, i) => (
                  <Link key={i} href={n.href} className={`alert ${n.tone}`} style={{ textDecoration: "none", color: "inherit" }}><span className="dot" />{n.text}</Link>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <section className="kpis">
        <Kpi label="Cash and bank" value={fmt(pos.cash)} sub={`${month?.label}: ${fmt(month?.in)} in, ${fmt(month?.out)} out`} />
        <Kpi label="Customers owe us" value={fmt(pos.receivable)} sub="Issued invoices not yet paid" />
        <Kpi label="We owe suppliers" value={fmt(pos.payable)} sub="Approved expenses not yet paid" />
        <Kpi label="Net profit to date" value={fmt(pos.netProfit)} tone={pos.netProfit.isNegative() ? "out" : "in"} sub={`${fmt(pos.revenue)} revenue, ${fmt(pos.expenses)} costs`} />
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h2>Cash flow, last 6 months</h2>
            <div className="legend"><span><i style={{ background: "var(--accent)" }} />In</span><span><i style={{ background: "var(--rust)" }} />Out</span></div>
          </div>
          <CashFlowChart months={flow} />
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Project budgets</h2><Link href="/projects" className="small">All projects</Link></div>
          {projects.length === 0 ? <Empty title="No projects yet">Add a project and its budget to track spending.</Empty> : (
            <div className="bars">
              {projects.filter((p) => p.project.status !== "CANCELLED").map((p) => (
                <Link key={p.project.id} href={`/projects/${p.project.id}`} className="bar-row" style={{ color: "inherit", textDecoration: "none" }}>
                  <div className="bar-top"><b>{clean(p.project.name)}</b><span className="num">{fmt(p.cost)} / {fmt(p.budget)}</span></div>
                  <Bar used={p.budgetUsed} />
                  <span className="small muted">{Math.round(p.budgetUsed)}% of budget spent · site {p.project.progress}% done · expected profit {fmt(p.expectedProfit)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid2 even">
        <section className="panel">
          <div className="panel-head"><h2>Where the money goes</h2>{topCost && <span className="small muted">Approved and paid costs</span>}</div>
          {breakdown.length === 0 ? <span className="muted">No approved costs yet.</span> : (
            <div className="bars">
              {breakdown.slice(0, 7).map((b) => (
                <div key={b.category} className="bar-row">
                  <div className="bar-top"><b>{CATEGORY_LABEL[b.category]}</b><span className="num">{fmt(b.total)}</span></div>
                  <Bar used={pct(b.total, topCost!)} tone="rust" />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Drafts and waiting for approval</h2><Link href="/expenses" className="small">All expenses</Link></div>
          {pending.length === 0 ? <span className="muted">Nothing waiting.</span> : (
            <div className="tablewrap"><table>
              <tbody>{pending.map((e) => (
                <tr key={e.id} className="link">
                  <td><Link href={`/expenses/${e.id}`}>{e.number}</Link><br /><span className="small muted">{fmtDate(e.date)}</span></td>
                  <td>{e.description}<br /><span className="small muted">{e.project ? clean(e.project.name) : "General overhead"}</span></td>
                  <td className="r num">{fmt(e.amount)}</td>
                  <td><Pill status={e.status} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
