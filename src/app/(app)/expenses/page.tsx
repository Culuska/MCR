import Link from "next/link";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { ExpenseCategory, ExpenseStatus } from "@/generated/prisma/enums";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { CATEGORY_LABEL, label } from "@/lib/domain";
import { fmt, fmtDate, sum } from "@/lib/money";
import { Empty, PageHead, Pill, clean } from "@/components/ui";

export const metadata = { title: "Expenses" };

type SP = { status?: string; project?: string; category?: string; q?: string };

export default async function Expenses({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireRead("expenses");
  const sp = await searchParams;
  const where: Prisma.ExpenseWhereInput = {};
  if (sp.status && sp.status in ExpenseStatus) where.status = sp.status as keyof typeof ExpenseStatus;
  if (sp.project) where.projectId = sp.project === "none" ? null : sp.project;
  if (sp.category && sp.category in ExpenseCategory) where.category = sp.category as keyof typeof ExpenseCategory;
  if (sp.q) where.OR = [{ description: { contains: sp.q, mode: "insensitive" } }, { number: { contains: sp.q, mode: "insensitive" } }, { payee: { contains: sp.q, mode: "insensitive" } }];

  const [rows, projects] = await Promise.all([
    db.expense.findMany({ where, include: { project: true, supplier: true }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 200 }),
    db.project.findMany({ orderBy: { code: "asc" } }),
  ]);
  const live = rows.filter((r) => r.status !== "VOID");

  return (
    <>
      <PageHead title="Expenses" sub="Draft, submitted, approved, paid. Nothing is deleted; mistakes are voided.">
        {canWrite(user.role, "expenses") && <Link className="btn primary" href="/expenses/new">New expense</Link>}
      </PageHead>

      <form className="filters" action="/expenses">
        <input name="q" placeholder="Search number, description, payee" defaultValue={sp.q} aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">Any status</option>{Object.values(ExpenseStatus).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select name="project" defaultValue={sp.project ?? ""} aria-label="Project"><option value="">All projects</option><option value="none">General overhead</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Category"><option value="">All categories</option>{Object.values(ExpenseCategory).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
        {(sp.q || sp.status || sp.project || sp.category) && <Link href="/expenses" className="small">Clear</Link>}
      </form>

      {rows.length === 0 ? <Empty title="No expenses match">Change the filters, or record a new expense.</Empty> : (
        <section className="panel">
          <div className="panel-head"><h2>{rows.length} expense{rows.length === 1 ? "" : "s"}</h2><span className="num small muted">Total excluding void: {fmt(sum(live.map((r) => r.amount)))}</span></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Number</th><th>Date</th><th>Description</th><th>Project</th><th>Category</th><th>Status</th><th className="r">Amount</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="link">
                <td><Link href={`/expenses/${e.id}`}>{e.number}</Link></td>
                <td className="num">{fmtDate(e.date)}</td>
                <td>{e.description}{(e.supplier || e.payee) && <><br /><span className="small muted">{e.supplier?.name ?? e.payee}</span></>}</td>
                <td>{e.project ? <Link href={`/projects/${e.project.id}`}>{e.project.code}</Link> : <span className="muted">Overhead</span>}{e.project && <><br /><span className="small muted">{clean(e.project.name)}</span></>}</td>
                <td>{CATEGORY_LABEL[e.category]}</td>
                <td><Pill status={e.status} /></td>
                <td className="r num" style={e.status === "VOID" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{fmt(e.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
