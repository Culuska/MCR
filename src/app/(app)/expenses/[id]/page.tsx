import Link from "next/link";
import { requireExpense } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { CATEGORY_LABEL, METHOD_LABEL } from "@/lib/domain";
import { D, fmt2, fmtDate, sum } from "@/lib/money";
import { PageHead, Pill, clean } from "@/components/ui";
import { Attachments } from "@/components/Attachments";
import { StepForm } from "@/components/ActionForm";
import { ExpenseForm } from "@/components/ExpenseForm";
import { AuditFor, JournalFor, PaymentForm, PaymentList } from "@/components/RecordParts";
import { payExpense, transitionExpense } from "@/actions/expenses";

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("expenses");
  const { id } = await params;
  await requireExpense(user, id);
  const e = await db.expense.findUnique({
    where: { id },
    include: { project: true, supplier: true, asset: true, task: true, createdBy: true, approvedBy: true, payments: { include: { account: true }, orderBy: { date: "asc" } } },
  });
  if (!e) notFound();

  const isFinance = APPROVERS.includes(user.role);
  const writer = canWrite(user.role, "expenses");
  const paid = sum(e.payments.filter((p) => !p.voided).map((p) => p.amount));
  const outstanding = D(e.amount).minus(paid);
  const ownDraft = e.createdById === user.id || isFinance;

  return (
    <>
      <PageHead title={e.number} sub={`${e.description}`}>
        <Pill status={e.status} />
        <Link className="btn" href="/expenses">All expenses</Link>
      </PageHead>

      <section className="panel">
        <div className="fields three">
          <div><span className="label">Amount</span><br /><span className="num" style={{ fontSize: 22 }}>{fmt2(e.amount)}</span></div>
          <div><span className="label">Date</span><br />{fmtDate(e.date)}</div>
          <div><span className="label">Category</span><br />{CATEGORY_LABEL[e.category]}</div>
          <div><span className="label">Project</span><br />{e.project ? <Link href={`/projects/${e.project.id}`}>{e.project.code} {clean(e.project.name)}</Link> : "General overhead"}</div>
          <div><span className="label">Supplier / payee</span><br />{e.supplier?.name ?? e.payee ?? "—"}</div>
          <div><span className="label">Machine or vehicle</span><br />{e.asset ? <Link href={`/assets/${e.asset.id}`}>{e.asset.name}</Link> : "—"}</div>
          <div><span className="label">Site task</span><br />{e.task ? <Link href="/operations?tab=tasks">{e.task.number} {e.task.title}</Link> : "—"}</div>
          <div><span className="label">Expected method</span><br />{e.paymentMethod ? METHOD_LABEL[e.paymentMethod] : "—"}</div>
          <div><span className="label">Entered by</span><br />{e.createdBy.name}</div>
          <div><span className="label">Approved by</span><br />{e.approvedBy ? `${e.approvedBy.name}, ${fmtDate(e.approvedAt)}` : "—"}</div>
          <div><span className="label">Paid so far</span><br /><span className="num">{fmt2(paid)}</span>{e.status === "APPROVED" && <> of <span className="num">{fmt2(e.amount)}</span></>}</div>
        </div>
        {e.notes && <div className="notice">{e.notes}</div>}

        <div className="row">
          {e.status === "DRAFT" && writer && ownDraft && <StepForm action={transitionExpense} id={e.id} to="SUBMIT" label="Submit for approval" primary />}
          {e.status === "SUBMITTED" && isFinance && (
            <>
              <StepForm action={transitionExpense} id={e.id} to="APPROVE" label="Approve" primary />
              <StepForm action={transitionExpense} id={e.id} to="REJECT" label="Send back" ask="Reason" />
            </>
          )}
          {e.status === "SUBMITTED" && !isFinance && <span className="muted small">Waiting for finance to approve.</span>}
          {(e.status === "DRAFT" || e.status === "SUBMITTED") && writer && (e.createdById === user.id || isFinance) && e.category !== "STOCK_PURCHASE" && <DeleteButton kind="expense" id={e.id} name={e.number} redirectTo="/expenses" />}
          {(e.status === "APPROVED" || e.status === "PAID") && isFinance && <StepForm action={transitionExpense} id={e.id} to="VOID" label="Void expense" ask="Reason for voiding" danger />}
        </div>
      </section>

      {e.status === "DRAFT" && writer && ownDraft && (
        <details className="more"><summary>Edit draft</summary><div className="body"><ExpenseForm expense={e} /></div></details>
      )}

      {e.status === "APPROVED" && isFinance && outstanding.greaterThan(0) && (
        <section className="panel"><h2>Record a payment</h2><PaymentForm action={payExpense} idName="expenseId" idValue={e.id} outstanding={outstanding.toFixed(2)} verb="Pay" /></section>
      )}

      {e.payments.length > 0 && <section className="panel"><h2>Payments</h2><PaymentList payments={e.payments} canVoid={isFinance} /></section>}

      <Attachments entity="Expense" id={e.id} user={user} title="Receipts and documents" hint="Attach the receipt or supplier invoice so whoever approves it can see what was bought." expected={e.status !== "DRAFT" && D(e.amount).greaterThanOrEqualTo(100) ? "No receipt is attached yet. Expenses of $100 or more should have one." : undefined} />

      <div className="grid2 even">
        <section className="panel"><h2>Ledger entries</h2><JournalFor sourceIds={[e.id, ...e.payments.map((p) => p.id)]} /></section>
        <section className="panel"><h2>History</h2><AuditFor entity="Expense" ids={[e.id]} /></section>
      </div>
    </>
  );
}
