import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { receiveGoods, reverseReceipt, transitionOrder } from "@/actions/stock";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { AuditFor } from "@/components/RecordParts";
import { Field, Kpi, PageHead, Pill, clean } from "@/components/ui";
import { Attachments } from "@/components/Attachments";
import { label } from "@/lib/domain";
import { D, fmt2, fmtDate, sum, toDateInput } from "@/lib/money";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("purchasing");
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true, project: true,
      lines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
      receipts: { include: { lines: { include: { material: true } }, expense: true }, orderBy: { receivedDate: "desc" } },
    },
  });
  if (!po) notFound();

  const writer = canWrite(user.role, "purchasing");
  const isFinance = APPROVERS.includes(user.role);
  const total = sum(po.lines.map((l) => D(l.quantity).times(l.unitPrice)));
  const receivedValue = sum(po.lines.map((l) => D(l.received).times(l.unitPrice)));
  const canReceive = writer && (po.status === "ORDERED" || po.status === "PART_RECEIVED");
  const cell = { padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit", width: 110 } as const;

  return (
    <>
      <PageHead title={po.number} sub={`${po.supplier.name}${po.project ? " · for " + po.project.code + " " + clean(po.project.name) : ""}`}>
        <Pill status="ACTIVE" text={label(po.status)} />
        <Link className="btn" href="/materials?tab=orders">All orders</Link>
      </PageHead>

      <section className="kpis">
        <Kpi label="Order value" value={fmt2(total)} sub={`${po.lines.length} line${po.lines.length === 1 ? "" : "s"}`} />
        <Kpi label="Received so far" value={fmt2(receivedValue)} />
        <Kpi label="Ordered on" value={fmtDate(po.orderDate)} />
        <Kpi label="Expected" value={fmtDate(po.expectedDate)} />
      </section>
      {po.notes && <div className="notice">{po.notes}</div>}

      <div className="row">
        {writer && po.status === "DRAFT" && <StepForm action={transitionOrder} id={po.id} to="ORDER" label="Mark as ordered" primary />}
        {writer && (po.status === "DRAFT" || po.status === "ORDERED") && <StepForm action={transitionOrder} id={po.id} to="CANCEL" label="Cancel order" danger />}
      </div>

      <section className="panel">
        <h2>Items</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Material</th><th className="r">Ordered</th><th className="r">Received</th><th className="r">Still due</th><th className="r">Price</th><th className="r">Line total</th></tr></thead>
          <tbody>{po.lines.map((l) => {
            const due = D(l.quantity).minus(l.received);
            return (
              <tr key={l.id}>
                <td><b>{l.material.name}</b></td><td className="r num">{String(l.quantity)} {l.material.unit}</td><td className="r num">{String(l.received)}</td>
                <td className={`r num ${due.greaterThan(0) ? "out" : ""}`}>{due.greaterThan(0) ? String(due) : "—"}</td><td className="r num">{fmt2(l.unitPrice)}</td><td className="r num">{fmt2(D(l.quantity).times(l.unitPrice))}</td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={5}>Total</td><td className="r num">{fmt2(total)}</td></tr></tfoot>
        </table></div>
      </section>

      {canReceive && (
        <section className="panel">
          <h2>Record a delivery</h2>
          <ActionForm action={receiveGoods} resetOnOk>
            <input type="hidden" name="orderId" value={po.id} />
            <div className="fields three">
              <Field name="receivedDate" label="Date received"><input id="receivedDate" name="receivedDate" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
              <Field name="invoiceNumber" label="Supplier invoice number" hint="The same invoice cannot be recorded twice."><input id="invoiceNumber" name="invoiceNumber" required /></Field>
            </div>
            <div className="tablewrap"><table>
              <thead><tr><th>Material</th><th className="r">Still due</th><th>Quantity received</th></tr></thead>
              <tbody>{po.lines.filter((l) => D(l.quantity).minus(l.received).greaterThan(0)).map((l) => (
                <tr key={l.id}><td>{l.material.name}</td><td className="r num">{String(D(l.quantity).minus(l.received))} {l.material.unit}</td>
                  <td><input name={`r_${l.id}`} type="number" step="0.001" min="0" max={String(D(l.quantity).minus(l.received))} aria-label={`Received ${l.material.name}`} style={cell} /></td></tr>
              ))}</tbody>
            </table></div>
            <div className="row"><Submit>Receive into stock</Submit><span className="hint">A draft supplier bill is raised for finance to approve and pay.</span></div>
          </ActionForm>
        </section>
      )}

      {po.receipts.length > 0 && (
        <section className="panel">
          <h2>Deliveries</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Receipt</th><th>Date</th><th>Invoice</th><th>Items</th><th>Bill</th><th /></tr></thead>
            <tbody>{po.receipts.map((g) => (
              <tr key={g.id} style={g.reversed ? { opacity: 0.55 } : undefined}>
                <td className="num">{g.number}{g.reversed && <> <span className="pill bad">Reversed</span></>}</td><td className="num">{fmtDate(g.receivedDate)}</td><td>{g.invoiceNumber}</td>
                <td className="small">{g.lines.map((l) => `${String(l.quantity)} ${l.material.unit} ${l.material.name}`).join(", ")}</td>
                <td>{g.expense ? <Link href={`/expenses/${g.expense.id}`}>{g.expense.number}</Link> : "—"} {g.expense && <Pill status={g.expense.status} />}</td>
                <td>{!g.reversed && isFinance && <StepForm action={reverseReceipt} id={g.id} to="REVERSE" label="Reverse" ask="Reason" danger />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <Attachments entity="PurchaseOrder" id={po.id} user={user} title="Delivery notes and supplier invoices" />

      <section className="panel"><h2>History</h2><AuditFor entity="PurchaseOrder" ids={[po.id]} /></section>
    </>
  );
}
