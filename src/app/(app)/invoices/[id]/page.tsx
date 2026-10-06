import Link from "next/link";
import { requireInvoice } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { D, fmt2, fmtDate, sum } from "@/lib/money";
import { PageHead, Pill, clean } from "@/components/ui";
import { Attachments } from "@/components/Attachments";
import { StepForm } from "@/components/ActionForm";
import { InvoiceForm } from "@/components/InvoiceForm";
import { AuditFor, JournalFor, PaymentForm, PaymentList } from "@/components/RecordParts";
import { receivePayment, transitionInvoice } from "@/actions/invoices";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("invoices");
  const { id } = await params;
  await requireInvoice(user, id);
  const inv = await db.invoice.findUnique({
    where: { id }, include: { customer: true, project: true, payments: { include: { account: true }, orderBy: { date: "asc" } } },
  });
  if (!inv) notFound();

  const writer = canWrite(user.role, "invoices");
  const isFinance = APPROVERS.includes(user.role);
  const paid = sum(inv.payments.filter((p) => !p.voided).map((p) => p.amount));
  const outstanding = D(inv.amount).minus(paid);
  const open = inv.status === "SENT" || inv.status === "PARTIAL";
  const overdue = open && inv.dueDate < new Date();

  return (
    <>
      <PageHead title={inv.number} sub={`${clean(inv.customer.name)} · ${inv.project.code}`}>
        {overdue ? <span className="pill bad">Overdue</span> : <Pill status={inv.status} />}
        <a className="btn" href={`/api/pdf/invoice/${inv.id}`} target="_blank" rel="noreferrer">Invoice PDF</a>
        <Link className="btn" href="/invoices">All invoices</Link>
      </PageHead>

      <section className="panel">
        <div className="fields three">
          <div><span className="label">Amount</span><br /><span className="num" style={{ fontSize: 22 }}>{fmt2(inv.amount)}</span></div>
          <div><span className="label">Received</span><br /><span className="num in">{fmt2(paid)}</span></div>
          <div><span className="label">Outstanding</span><br /><span className={`num ${overdue ? "out" : ""}`}>{open ? fmt2(outstanding) : "—"}</span></div>
          <div><span className="label">Issued</span><br />{fmtDate(inv.issueDate)}</div>
          <div><span className="label">Due</span><br />{fmtDate(inv.dueDate)}</div>
          <div><span className="label">Project</span><br /><Link href={`/projects/${inv.project.id}`}>{clean(inv.project.name)}</Link></div>
        </div>
        {inv.notes && <div className="notice">{inv.notes}</div>}
        <div className="row">
          {inv.status === "DRAFT" && writer && <StepForm action={transitionInvoice} id={inv.id} to="SEND" label="Issue invoice" primary />}
          {inv.status === "DRAFT" && isFinance && <StepForm action={transitionInvoice} id={inv.id} to="VOID" label="Void draft" ask="Reason" danger />}
          {inv.status === "DRAFT" && writer && <DeleteButton kind="invoice" id={inv.id} name={inv.number} redirectTo="/invoices" />}
          {(open || inv.status === "PAID") && isFinance && inv.payments.every((p) => p.voided) && <StepForm action={transitionInvoice} id={inv.id} to="VOID" label="Void invoice" ask="Reason for voiding" danger />}
          {(open || inv.status === "PAID") && isFinance && inv.payments.some((p) => !p.voided) && <span className="small muted">To void this invoice, void its payments first.</span>}
        </div>
      </section>

      {inv.status === "DRAFT" && writer && <details className="more"><summary>Edit draft</summary><div className="body"><InvoiceForm invoice={inv} /></div></details>}

      {open && writer && (
        <section className="panel"><h2>Record a customer payment</h2><PaymentForm action={receivePayment} idName="invoiceId" idValue={inv.id} outstanding={outstanding.toFixed(2)} verb="Record receipt" /></section>
      )}
      {inv.payments.length > 0 && <section className="panel"><h2>Payments received</h2><PaymentList payments={inv.payments} canVoid={isFinance} /></section>}

      <Attachments entity="Invoice" id={inv.id} user={user} title="Documents" hint="The signed certificate, the customer's purchase order or proof of payment." />

      <div className="grid2 even">
        <section className="panel"><h2>Ledger entries</h2><JournalFor sourceIds={[inv.id, ...inv.payments.map((p) => p.id)]} /></section>
        <section className="panel"><h2>History</h2><AuditFor entity="Invoice" ids={[inv.id]} /></section>
      </div>
    </>
  );
}
