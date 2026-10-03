import Link from "next/link";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { AGE_BUCKETS, cashFlow, companyPosition, ledgerBalances, payables, receivables, subcontractFigures } from "@/lib/finance";
import { fmt, fmt2, fmtDate, sum } from "@/lib/money";
import { CATEGORY_LABEL } from "@/lib/domain";
import { CashFlowChart } from "@/components/charts";
import { Empty, Kpi, PageHead, Tabs, clean } from "@/components/ui";

export const metadata = { title: "Finance" };

const TABS = [
  { key: "statements", label: "Statements" }, { key: "trial", label: "Trial balance" }, { key: "ledger", label: "General ledger" },
  { key: "cash", label: "Cash flow" }, { key: "receivable", label: "Receivables" }, { key: "payable", label: "Payables" },
];

export default async function Finance({ searchParams }: { searchParams: Promise<{ tab?: string; account?: string; project?: string }> }) {
  await requireRead("finance");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "statements";

  return (
    <>
      <PageHead title="Finance" sub="Double-entry books. Every figure here comes from posted journal entries." />
      <Tabs current={tab} items={TABS.map((t) => ({ ...t, href: `/finance?tab=${t.key}` }))} />
      {tab === "statements" && <Statements />}
      {tab === "trial" && <Trial />}
      {tab === "ledger" && <Ledger account={sp.account} project={sp.project} />}
      {tab === "cash" && <Cash />}
      {tab === "receivable" && <Receivable />}
      {tab === "payable" && <Payable />}
    </>
  );
}

const Row = ({ a, b }: { a: string; b: string }) => <tr><td>{a}</td><td className="r num">{b}</td></tr>;

async function Statements() {
  const p = await companyPosition();
  const income = p.rows.filter((r) => r.type === "INCOME" && !r.balance.isZero());
  const costs = p.rows.filter((r) => r.type === "EXPENSE" && !r.balance.isZero());
  const assets = p.rows.filter((r) => r.type === "ASSET" && !r.balance.isZero());
  const liabilities = p.rows.filter((r) => r.type === "LIABILITY" && !r.balance.isZero());
  const equity = p.rows.filter((r) => r.type === "EQUITY" && !r.balance.isZero());
  return (
    <div className="grid2 even">
      <section className="panel">
        <h2>Profit and loss</h2>
        <div className="tablewrap"><table>
          <tbody>
            <tr><td colSpan={2} className="label">Income</td></tr>
            {income.map((r) => <Row key={r.id} a={`${r.code} ${r.name}`} b={fmt2(r.balance)} />)}
            <tr><td colSpan={2} className="label">Costs</td></tr>
            {costs.map((r) => <Row key={r.id} a={`${r.code} ${r.name}`} b={fmt2(r.balance)} />)}
          </tbody>
          <tfoot><tr><td>Net profit</td><td className={`r num ${p.netProfit.isNegative() ? "out" : "in"}`}>{fmt2(p.netProfit)}</td></tr></tfoot>
        </table></div>
      </section>
      <section className="panel">
        <h2>Balance sheet</h2>
        <div className="tablewrap"><table>
          <tbody>
            <tr><td colSpan={2} className="label">Assets</td></tr>
            {assets.map((r) => <Row key={r.id} a={`${r.code} ${r.name}`} b={fmt2(r.balance)} />)}
            <tr><td><b>Total assets</b></td><td className="r num"><b>{fmt2(p.assets)}</b></td></tr>
            <tr><td colSpan={2} className="label">Liabilities</td></tr>
            {liabilities.map((r) => <Row key={r.id} a={`${r.code} ${r.name}`} b={fmt2(r.balance)} />)}
            <tr><td colSpan={2} className="label">Equity</td></tr>
            {equity.map((r) => <Row key={r.id} a={`${r.code} ${r.name}`} b={fmt2(r.balance)} />)}
            <Row a="Profit to date" b={fmt2(p.netProfit)} />
          </tbody>
          <tfoot><tr><td>Liabilities and equity</td><td className="r num">{fmt2(p.liabilities.plus(p.equity).plus(p.netProfit))}</td></tr></tfoot>
        </table></div>
        {p.assets.equals(p.liabilities.plus(p.equity).plus(p.netProfit)) ? <span className="pill good" style={{ justifySelf: "start" }}>Balanced</span> : <span className="pill bad" style={{ justifySelf: "start" }}>Out of balance</span>}
      </section>
    </div>
  );
}

async function Trial() {
  const rows = (await ledgerBalances()).filter((r) => !r.debit.isZero() || !r.credit.isZero());
  const debit = sum(rows.map((r) => r.debit)), credit = sum(rows.map((r) => r.credit));
  return (
    <section className="panel"><div className="tablewrap"><table>
      <thead><tr><th>Account</th><th>Type</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}><td><Link href={`/finance?tab=ledger&account=${r.id}`}>{r.code} {r.name}</Link></td><td className="muted">{r.type.toLowerCase()}</td><td className="r num">{r.debit.isZero() ? "" : fmt2(r.debit)}</td><td className="r num">{r.credit.isZero() ? "" : fmt2(r.credit)}</td></tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={2}>Total {debit.equals(credit) ? <span className="pill good">Balanced</span> : <span className="pill bad">Out of balance</span>}</td><td className="r num">{fmt2(debit)}</td><td className="r num">{fmt2(credit)}</td></tr></tfoot>
    </table></div></section>
  );
}

async function Ledger({ account, project }: { account?: string; project?: string }) {
  const [accounts, projects] = await Promise.all([db.account.findMany({ orderBy: { code: "asc" } }), db.project.findMany({ orderBy: { code: "asc" } })]);
  const lines = await db.journalLine.findMany({
    where: { accountId: account || undefined, projectId: project || undefined },
    include: { entry: true, account: true, project: true }, orderBy: [{ entry: { date: "desc" } }, { entry: { number: "desc" } }], take: 250,
  });
  return (
    <>
      <form className="filters" action="/finance">
        <input type="hidden" name="tab" value="ledger" />
        <select name="account" defaultValue={account ?? ""} aria-label="Account"><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
        <select name="project" defaultValue={project ?? ""} aria-label="Project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
        {(account || project) && <Link className="small" href="/finance?tab=ledger">Clear</Link>}
      </form>
      {lines.length === 0 ? <Empty title="No ledger lines match" /> : (
        <section className="panel"><div className="panel-head"><h2>Latest {lines.length} lines</h2><span className="small muted">Newest first</span></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Date</th><th>Entry</th><th>Description</th><th>Account</th><th>Project</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}>
                <td className="num">{fmtDate(l.entry.date)}</td><td className="num">{l.entry.number}</td><td>{l.entry.description}</td>
                <td>{l.account.code} {l.account.name}</td><td>{l.project?.code ?? "—"}</td>
                <td className="r num">{Number(l.debit) > 0 ? fmt2(l.debit) : ""}</td><td className="r num">{Number(l.credit) > 0 ? fmt2(l.credit) : ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}

async function Cash() {
  const [flow, p] = await Promise.all([cashFlow(6), companyPosition()]);
  const accounts = p.rows.filter((r) => r.isCash);
  return (
    <>
      <section className="kpis">
        {accounts.map((a) => <Kpi key={a.id} label={a.name} value={fmt(a.balance)} />)}
        <Kpi label="Total cash and bank" value={fmt(p.cash)} />
      </section>
      <div className="grid2">
        <section className="panel"><div className="panel-head"><h2>Money in and out</h2><div className="legend"><span><i style={{ background: "var(--accent)" }} />In</span><span><i style={{ background: "var(--rust)" }} />Out</span></div></div><CashFlowChart months={flow} /></section>
        <section className="panel"><h2>Month by month</h2><div className="tablewrap"><table>
          <thead><tr><th>Month</th><th className="r">Opening</th><th className="r">In</th><th className="r">Out</th><th className="r">Closing</th></tr></thead>
          <tbody>{flow.map((m) => <tr key={m.key}><td>{m.label}</td><td className="r num">{fmt(m.opening)}</td><td className="r num in">{fmt(m.in)}</td><td className="r num out">{fmt(m.out)}</td><td className="r num">{fmt(m.closing)}</td></tr>)}</tbody>
        </table></div></section>
      </div>
    </>
  );
}

async function Receivable() {
  const rows = await receivables();
  if (!rows.length) return <Empty title="Nothing outstanding">No issued invoices are waiting for payment.</Empty>;
  return (
    <>
      <section className="kpis">{AGE_BUCKETS.map((b) => <Kpi key={b} label={b} value={fmt(sum(rows.filter((r) => r.age === b).map((r) => r.outstanding)))} />)}</section>
      <section className="panel"><div className="tablewrap"><table>
        <thead><tr><th>Invoice</th><th>Customer</th><th>Project</th><th>Due</th><th>Age</th><th className="r">Invoice</th><th className="r">Outstanding</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td><Link href={`/invoices/${r.id}`}>{r.number}</Link></td><td>{clean(r.customer.name)}</td><td>{r.project.code}</td><td className="num">{fmtDate(r.dueDate)}</td>
            <td>{r.overdue ? <span className="pill bad">{r.age}</span> : <span className="pill">Not due</span>}</td><td className="r num">{fmt(r.amount)}</td><td className="r num">{fmt(r.outstanding)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={6}>Total owed by customers</td><td className="r num">{fmt(sum(rows.map((r) => r.outstanding)))}</td></tr></tfoot>
      </table></div></section>
    </>
  );
}

async function Payable() {
  const rows = (await payables()).filter((r) => r.outstanding.greaterThan(0));
  const subs = (await subcontractFigures()).filter((x) => x.unpaid.greaterThan(0) || x.retentionHeld.greaterThan(0));
  if (!rows.length && !subs.length) return <Empty title="Nothing owed">All approved expenses have been paid.</Empty>;
  return (
    <>
    {subs.length > 0 && (
      <section className="panel"><h2>Subcontractors</h2><div className="tablewrap"><table>
        <thead><tr><th>Subcontract</th><th>Subcontractor</th><th>Project</th><th className="r">Approved, unpaid</th><th className="r">Retention held</th></tr></thead>
        <tbody>{subs.map((x) => <tr key={x.sub.id}><td><Link href={`/subcontracts/${x.sub.id}`}>{x.sub.number}</Link></td><td>{x.sub.supplier.name}</td><td>{x.sub.project.code}</td><td className="r num out">{x.unpaid.greaterThan(0) ? fmt(x.unpaid) : "—"}</td><td className="r num">{x.retentionHeld.greaterThan(0) ? fmt(x.retentionHeld) : "—"}</td></tr>)}</tbody>
      </table></div></section>
    )}
    {rows.length > 0 && (
    <section className="panel"><div className="tablewrap"><table>
      <thead><tr><th>Expense</th><th>Date</th><th>Payee</th><th>Category</th><th>Project</th><th className="r">Amount</th><th className="r">Paid</th><th className="r">Owed</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}><td><Link href={`/expenses/${r.id}`}>{r.number}</Link></td><td className="num">{fmtDate(r.date)}</td><td>{r.supplier?.name ?? r.payee ?? "—"}</td><td>{CATEGORY_LABEL[r.category]}</td><td>{r.project?.code ?? "Overhead"}</td>
          <td className="r num">{fmt(r.amount)}</td><td className="r num">{fmt(r.paid)}</td><td className="r num out">{fmt(r.outstanding)}</td></tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={7}>Total owed to suppliers</td><td className="r num">{fmt(sum(rows.map((r) => r.outstanding)))}</td></tr></tfoot>
    </table></div></section>
    )}
    </>
  );
}
