import Link from "next/link";
import { db } from "@/lib/db";
import { InvoiceStatus } from "@/generated/prisma/enums";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { D, fmt, fmtDate, sum } from "@/lib/money";
import { label } from "@/lib/domain";
import { Empty, Kpi, PageHead, Pill, clean } from "@/components/ui";

export const metadata = { title: "Invoices" };

export default async function Invoices({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireRead("invoices");
  const { status } = await searchParams;
  const all = await db.invoice.findMany({
    include: { customer: true, project: true, payments: { where: { voided: false } } }, orderBy: [{ issueDate: "desc" }, { number: "desc" }],
  });
  const now = new Date();
  const rows = all.map((i) => {
    const paid = sum(i.payments.map((p) => p.amount));
    const outstanding = i.status === "SENT" || i.status === "PARTIAL" ? D(i.amount).minus(paid) : D(0);
    const overdue = outstanding.greaterThan(0) && i.dueDate < now;
    return { ...i, paid, outstanding, overdue };
  });
  const shown = rows.filter((r) => !status || (status === "OVERDUE" ? r.overdue : r.status === status));
  const owed = sum(rows.map((r) => r.outstanding));
  const overdueTotal = sum(rows.filter((r) => r.overdue).map((r) => r.outstanding));

  return (
    <>
      <PageHead title="Invoices" sub="What customers have been billed and what they still owe">
        {canWrite(user.role, "invoices") && <Link className="btn primary" href="/invoices/new">New invoice</Link>}
      </PageHead>
      <section className="kpis">
        <Kpi label="Outstanding" value={fmt(owed)} sub={`${rows.filter((r) => r.outstanding.greaterThan(0)).length} open invoices`} />
        <Kpi label="Overdue" value={fmt(overdueTotal)} tone={overdueTotal.greaterThan(0) ? "out" : undefined} sub={`${rows.filter((r) => r.overdue).length} past due date`} />
        <Kpi label="Paid to date" value={fmt(sum(rows.filter((r) => r.status !== "VOID").map((r) => r.paid)))} sub="Receipts recorded" />
        <Kpi label="Drafts" value={String(rows.filter((r) => r.status === "DRAFT").length)} sub="Not yet issued" />
      </section>

      <form className="filters" action="/invoices">
        <select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">All invoices</option>
          <option value="OVERDUE">Overdue</option>
          {Object.values(InvoiceStatus).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
        {status && <Link href="/invoices" className="small">Clear</Link>}
      </form>

      {shown.length === 0 ? <Empty title="No invoices match">Raise an invoice from a project to start billing.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Invoice</th><th>Customer</th><th>Project</th><th>Issued</th><th>Due</th><th>Status</th><th className="r">Amount</th><th className="r">Outstanding</th></tr></thead>
          <tbody>{shown.map((i) => (
            <tr key={i.id} className="link">
              <td><Link href={`/invoices/${i.id}`}>{i.number}</Link></td>
              <td>{clean(i.customer.name)}</td>
              <td><Link href={`/projects/${i.project.id}`}>{i.project.code}</Link></td>
              <td className="num">{fmtDate(i.issueDate)}</td>
              <td className="num">{fmtDate(i.dueDate)}</td>
              <td>{i.overdue ? <span className="pill bad">Overdue</span> : <Pill status={i.status} />}</td>
              <td className="r num" style={i.status === "VOID" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{fmt(i.amount)}</td>
              <td className={`r num ${i.overdue ? "out" : ""}`}>{i.outstanding.greaterThan(0) ? fmt(i.outstanding) : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}
