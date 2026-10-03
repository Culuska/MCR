import { db } from "@/lib/db";
import { ActionForm, Submit, StepForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { METHOD_LABEL } from "@/lib/domain";
import { fmt2, fmtDate, toDateInput } from "@/lib/money";
import type { FormState } from "@/lib/action";
import { voidPayment } from "@/actions/invoices";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export async function PaymentForm({ action, idName, idValue, outstanding, verb }: {
  action: Action; idName: string; idValue: string; outstanding: string; verb: "Pay" | "Record receipt";
}) {
  const accounts = await db.account.findMany({ where: { isCash: true, active: true }, orderBy: { code: "asc" } });
  return (
    <ActionForm action={action} resetOnOk>
      <input type="hidden" name={idName} value={idValue} />
      <div className="fields three">
        <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} /></Field>
        <Field name="amount" label="Amount (USD)" hint={`Outstanding ${fmt2(outstanding)}`}>
          <input id="amount" name="amount" type="number" step="0.01" min="0.01" max={outstanding} inputMode="decimal" required defaultValue={outstanding} />
        </Field>
        <Field name="accountId" label={verb === "Pay" ? "Paid from" : "Received into"}>
          <select id="accountId" name="accountId" required defaultValue={accounts[0]?.id}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </Field>
        <Field name="method" label="Method">
          <select id="method" name="method" required defaultValue="BANK_TRANSFER">{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field name="reference" label="Reference"><input id="reference" name="reference" placeholder="Transfer or receipt number" /></Field>
      </div>
      <div className="row"><Submit>{verb === "Pay" ? "Record payment" : "Record receipt"}</Submit></div>
    </ActionForm>
  );
}

type PayRow = { id: string; number: string; date: Date; amount: { toString(): string }; method: keyof typeof METHOD_LABEL; reference: string | null; voided: boolean; account: { name: string } };

export function PaymentList({ payments, canVoid }: { payments: PayRow[]; canVoid: boolean }) {
  if (!payments.length) return <span className="muted">No payments yet.</span>;
  return (
    <div className="tablewrap"><table>
      <thead><tr><th>Number</th><th>Date</th><th>Account</th><th>Method</th><th>Reference</th><th className="r">Amount</th><th /></tr></thead>
      <tbody>{payments.map((p) => (
        <tr key={p.id} style={p.voided ? { opacity: 0.55 } : undefined}>
          <td className="num">{p.number}</td><td className="num">{fmtDate(p.date)}</td><td>{p.account.name}</td><td>{METHOD_LABEL[p.method]}</td><td>{p.reference ?? "—"}</td>
          <td className="r num" style={p.voided ? { textDecoration: "line-through" } : undefined}>{fmt2(p.amount.toString())}</td>
          <td>{p.voided ? <span className="pill bad">Void</span> : canVoid && <StepForm action={voidPayment} id={p.id} to="VOID" label="Void" ask="Reason" danger />}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

// The ledger entries a record created. Reversals appear alongside the originals so history stays whole.
export async function JournalFor({ sourceIds }: { sourceIds: string[] }) {
  const entries = await db.journalEntry.findMany({
    where: { sourceId: { in: sourceIds } }, orderBy: { createdAt: "asc" },
    include: { lines: { include: { account: true } } },
  });
  if (!entries.length) return <span className="muted">Nothing has been posted to the ledger yet.</span>;
  return (
    <div className="tablewrap"><table>
      <thead><tr><th>Entry</th><th>Date</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
      <tbody>{entries.flatMap((e) => e.lines.map((l, i) => (
        <tr key={l.id} style={e.status === "REVERSED" ? { opacity: 0.6 } : undefined}>
          <td className="num">{i === 0 ? <>{e.number} {e.status === "REVERSED" && <span className="pill bad">Reversed</span>}{e.reversesId && <span className="pill warn">Reversal</span>}</> : ""}</td>
          <td className="num">{i === 0 ? fmtDate(e.date) : ""}</td>
          <td style={{ paddingLeft: Number(l.credit) > 0 ? 28 : undefined }}>{l.account.code} {l.account.name}</td>
          <td className="r num">{Number(l.debit) > 0 ? fmt2(l.debit) : ""}</td>
          <td className="r num">{Number(l.credit) > 0 ? fmt2(l.credit) : ""}</td>
        </tr>
      )))}</tbody>
    </table></div>
  );
}

export async function AuditFor({ entity, ids }: { entity: string; ids: string[] }) {
  const rows = await db.auditLog.findMany({ where: { entity, entityId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!rows.length) return <span className="muted">No history yet.</span>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
      {rows.map((r) => (
        <li key={r.id}><span className="small muted num">{r.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><br />{r.summary}</li>
      ))}
    </ul>
  );
}
