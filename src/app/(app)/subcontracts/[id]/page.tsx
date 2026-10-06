import Link from "next/link";
import { requireRecord } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { subcontractFigures } from "@/lib/finance";
import { addScheduleItem, addVariation, createCertificate, decideVariation, payCertificate, releaseRetention, removeScheduleItem, transitionCertificate, transitionSubcontract, voidRelease } from "@/actions/subcontracts";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { SubcontractForm } from "@/components/SubcontractForm";
import { AuditFor, JournalFor } from "@/components/RecordParts";
import { Bar, Field, Kpi, PageHead, Pill, clean } from "@/components/ui";
import { Attachments } from "@/components/Attachments";
import { METHOD_LABEL, label } from "@/lib/domain";
import { D, fmt, fmt2, fmtDate, sum, toDateInput } from "@/lib/money";

const small = { padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" } as const;

export default async function SubcontractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("subcontracts");
  const { id } = await params;
  await requireRecord(user, "subcontract", id);
  const base = await db.subcontract.findUnique({ where: { id }, include: { supplier: true, project: true, variations: { orderBy: { createdAt: "asc" } }, schedule: { orderBy: { dueDate: "asc" } }, certificates: { orderBy: { seq: "asc" } }, releases: { orderBy: { date: "asc" } } } });
  if (!base) notFound();

  const [figures, accounts] = await Promise.all([subcontractFigures(base.projectId), db.account.findMany({ where: { isCash: true, active: true }, orderBy: { code: "asc" } })]);
  const f = figures.find((x) => x.sub.id === id);
  const s = base;
  const writer = canWrite(user.role, "subcontracts");
  const isFinance = APPROVERS.includes(user.role);
  const revised = f?.revised ?? D(s.contractValue), certified = f?.certified ?? D(0), held = f?.retentionHeld ?? D(0);
  const live = s.certificates.filter((c) => c.status !== "VOID");
  const latest = live[live.length - 1];
  const hasDraft = live.some((c) => c.status === "DRAFT");
  const canCertify = writer && s.status === "ACTIVE" && !hasDraft;
  const planned = sum(s.schedule.map((i) => i.amount));
  const ledgerIds = [...s.certificates.map((c) => c.id), ...s.releases.map((r) => r.id)];

  return (
    <>
      <PageHead title={s.number} sub={`${clean(s.supplier.name)} · ${s.project.code} ${clean(s.project.name)}`}>
        <Pill status="ACTIVE" text={label(s.status)} />
        {s.status === "DRAFT" && writer && <DeleteButton kind="subcontract" id={s.id} name={s.number} redirectTo="/subcontracts" />}
        <Link className="btn" href="/subcontracts">All subcontracts</Link>
      </PageHead>

      <section className="kpis">
        <Kpi label="Contract value" value={fmt2(revised)} sub={revised.equals(s.contractValue) ? `Original ${fmt(s.contractValue)}` : `Original ${fmt(s.contractValue)}, with approved variations`} />
        <Kpi label="Certified to date" value={fmt2(certified)} sub={`${Math.round(f?.percent ?? 0)}% of the contract · ${fmt2(f?.remaining ?? revised)} to go`} />
        <Kpi label="Paid" value={fmt2(f?.paid ?? D(0))} sub={f && f.unpaid.greaterThan(0) ? `${fmt2(f.unpaid)} approved, not yet paid` : "Nothing waiting"} />
        <Kpi label="Retention held" value={fmt2(held)} sub={`${s.retentionPct}% of each certificate`} />
      </section>

      <p style={{ margin: 0 }}>{s.scope}{s.notes ? <span className="muted"> · {s.notes}</span> : null}</p>
      <Bar used={f?.percent ?? 0} />

      <div className="row">
        {s.status === "DRAFT" && isFinance && <StepForm action={transitionSubcontract} id={s.id} to="ACTIVATE" label="Sign off subcontract" primary />}
        {s.status === "DRAFT" && !isFinance && <span className="muted small">Waiting for finance to sign it off.</span>}
        {s.status === "ACTIVE" && isFinance && <StepForm action={transitionSubcontract} id={s.id} to="COMPLETE" label="Mark complete" />}
        {(s.status === "DRAFT" || s.status === "ACTIVE") && isFinance && <StepForm action={transitionSubcontract} id={s.id} to="CANCEL" label="Cancel" ask="Reason" danger />}
      </div>

      {s.status === "DRAFT" && writer && <details className="more"><summary>Edit draft</summary><div className="body"><SubcontractForm subcontract={s} /></div></details>}

      {/* ------------------------------ certificates ------------------------------ */}
      <section className="panel">
        <div className="panel-head"><h2>Payment certificates</h2><span className="small muted">Each states the total value of work done to date. Only the new part is paid.</span></div>
        {canCertify && (
          <ActionForm action={createCertificate} resetOnOk>
            <input type="hidden" name="subcontractId" value={s.id} />
            <div className="fields three">
              <Field name="workToDate" label="Value of work done to date (USD)" hint={`Already certified ${fmt2(certified)}. At most ${fmt2(revised)}.`}><input id="workToDate" name="workToDate" type="number" step="0.01" min={certified.plus(0.01).toFixed(2)} max={revised.toFixed(2)} required /></Field>
              <Field name="date" label="Certificate date"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
              <Field name="notes" label="Note"><input id="notes" name="notes" placeholder="Valuation no. 3, first floor complete" /></Field>
            </div>
            <div className="row"><Submit>Prepare certificate</Submit><span className="hint">Retention of {String(s.retentionPct)}% is taken off automatically.</span></div>
          </ActionForm>
        )}
        {hasDraft && <span className="small muted">There is a draft certificate. Approve or void it before preparing another.</span>}
        {s.certificates.length === 0 ? <span className="muted">No certificates yet.</span> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Certificate</th><th>Date</th><th className="r">Work to date</th><th className="r">This certificate</th><th className="r">Retention</th><th className="r">Payable</th><th>Status</th><th /></tr></thead>
            <tbody>{s.certificates.map((c) => (
              <tr key={c.id} style={c.status === "VOID" ? { opacity: 0.55 } : undefined}>
                <td className="num">{c.number}<br /><span className="small muted">no. {c.seq}</span><br /><a className="small" href={`/api/pdf/certificate/${c.id}`} target="_blank" rel="noreferrer">PDF</a></td><td className="num">{fmtDate(c.date)}</td>
                <td className="r num">{fmt2(c.workToDate)}</td><td className="r num">{fmt2(c.gross)}</td><td className="r num">{fmt2(c.retention)}</td><td className="r num"><b>{fmt2(c.net)}</b></td>
                <td><Pill status={c.status} />{c.status === "PAID" && <><br /><span className="small muted">{fmtDate(c.paidAt)}{c.payMethod ? ` · ${METHOD_LABEL[c.payMethod]}` : ""}</span></>}</td>
                <td>
                  <div className="row">
                    {c.status === "DRAFT" && isFinance && <StepForm action={transitionCertificate} id={c.id} to="APPROVE" label="Approve" primary />}
                    {c.status === "APPROVED" && isFinance && (
                      <details><summary className="small" style={{ cursor: "pointer" }}>Record payment</summary>
                        <ActionForm action={payCertificate} className="inline-form">
                          <input type="hidden" name="id" value={c.id} />
                          <input name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} aria-label="Payment date" style={small} />
                          <select name="accountId" required aria-label="Paid from" style={small}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                          <select name="method" required defaultValue="BANK_TRANSFER" aria-label="Method" style={small}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                          <input name="reference" placeholder="Reference" aria-label="Reference" style={small} />
                          <Submit className="btn sm primary">{`Pay ${fmt2(c.net)}`}</Submit>
                        </ActionForm>
                      </details>
                    )}
                    {c.status !== "VOID" && isFinance && latest?.id === c.id && <StepForm action={transitionCertificate} id={c.id} to="VOID" label="Void" ask="Reason" danger />}
                  </div>
                </td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}>Total on live certificates</td><td className="r num">{fmt2(sum(live.map((c) => c.gross)))}</td><td className="r num">{fmt2(sum(live.map((c) => c.retention)))}</td><td className="r num">{fmt2(sum(live.map((c) => c.net)))}</td><td colSpan={2} /></tr></tfoot>
          </table></div>
        )}
      </section>

      {/* ------------------------------ retention ------------------------------ */}
      <section className="panel">
        <div className="panel-head"><h2>Retention</h2><span className="small muted">{fmt2(held)} held</span></div>
        {s.status === "COMPLETED" && isFinance && held.greaterThan(0) && (
          <ActionForm action={releaseRetention} resetOnOk>
            <input type="hidden" name="subcontractId" value={s.id} />
            <div className="fields three">
              <Field name="amount" label="Amount to release (USD)" hint={`Up to ${fmt2(held)}`}><input id="amount" name="amount" type="number" step="0.01" min="0.01" max={held.toFixed(2)} required defaultValue={held.toFixed(2)} /></Field>
              <Field name="date" label="Date"><input id="rdate" name="date" type="date" required defaultValue={toDateInput(new Date())} max={toDateInput(new Date())} /></Field>
              <Field name="accountId" label="Paid from"><select id="raccount" name="accountId" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field name="method" label="Method"><select id="rmethod" name="method" required defaultValue="BANK_TRANSFER">{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field name="reference" label="Reference"><input id="rref" name="reference" /></Field>
            </div>
            <div className="row"><Submit>Release retention</Submit></div>
          </ActionForm>
        )}
        {s.status !== "COMPLETED" && held.greaterThan(0) && <span className="small muted">Retention can be released once the subcontract is marked complete.</span>}
        {s.releases.length > 0 && (
          <div className="tablewrap"><table>
            <thead><tr><th>Release</th><th>Date</th><th>Method</th><th className="r">Amount</th><th /></tr></thead>
            <tbody>{s.releases.map((r) => (
              <tr key={r.id} style={r.voided ? { opacity: 0.55 } : undefined}>
                <td className="num">{r.number}</td><td className="num">{fmtDate(r.date)}</td><td>{METHOD_LABEL[r.method]}{r.reference ? ` · ${r.reference}` : ""}</td><td className="r num">{fmt2(r.amount)}</td>
                <td>{r.voided ? <span className="pill bad">Void</span> : isFinance && <StepForm action={voidRelease} id={r.id} to="VOID" label="Void" ask="Reason" danger />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <div className="grid2 even">
        {/* ------------------------------ variations ------------------------------ */}
        <section className="panel">
          <h2>Variations</h2>
          {writer && s.status === "ACTIVE" && (
            <ActionForm action={addVariation} resetOnOk>
              <input type="hidden" name="subcontractId" value={s.id} />
              <div className="fields">
                <Field name="description" label="Change"><input id="vdesc" name="description" required minLength={3} placeholder="Extra sockets, ground floor" /></Field>
                <Field name="amount" label="Amount (USD)" hint="Minus for omitted work."><input id="vamount" name="amount" type="number" step="0.01" required /></Field>
              </div>
              <div className="row"><Submit>Propose variation</Submit></div>
            </ActionForm>
          )}
          {s.variations.length === 0 ? <span className="muted">None.</span> : (
            <div className="tablewrap"><table><tbody>{s.variations.map((v) => (
              <tr key={v.id}>
                <td>{v.description}</td><td className={`r num ${D(v.amount).isNegative() ? "out" : "in"}`}>{fmt2(v.amount)}</td>
                <td>{v.approved ? <span className="pill good">Approved</span> : isFinance ? (
                  <div className="row"><StepForm action={decideVariation} id={v.id} to="APPROVE" label="Approve" primary /><StepForm action={decideVariation} id={v.id} to="REJECT" label="Reject" danger /></div>
                ) : <span className="pill warn">Awaiting approval</span>}</td>
              </tr>
            ))}</tbody></table></div>
          )}
        </section>

        {/* ------------------------------ programme ------------------------------ */}
        <section className="panel">
          <div className="panel-head"><h2>Payment programme</h2><span className="small muted">{fmt(planned)} planned of {fmt(revised)}</span></div>
          {writer && s.status !== "CANCELLED" && s.status !== "COMPLETED" && (
            <ActionForm action={addScheduleItem} resetOnOk>
              <input type="hidden" name="subcontractId" value={s.id} />
              <div className="fields three">
                <Field name="description" label="Milestone"><input id="sdesc" name="description" required minLength={3} placeholder="Foundations complete" /></Field>
                <Field name="amount" label="Value (USD)"><input id="samount" name="amount" type="number" step="0.01" min="0.01" required /></Field>
                <Field name="dueDate" label="Due by"><input id="sdue" name="dueDate" type="date" required /></Field>
              </div>
              <div className="row"><Submit>Add milestone</Submit></div>
            </ActionForm>
          )}
          {s.schedule.length === 0 ? <span className="muted">No milestones set.</span> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Milestone</th><th>Due</th><th className="r">Value</th><th /></tr></thead>
              <tbody>{(() => { let running = D(0); return s.schedule.map((i) => {
                running = running.plus(i.amount);
                const late = i.dueDate.getTime() < Date.now() && certified.lessThan(running);
                return (
                  <tr key={i.id}><td>{i.description}</td><td className="num">{fmtDate(i.dueDate)}{late && <> <span className="pill warn">Behind</span></>}</td><td className="r num">{fmt2(i.amount)}<br /><span className="small muted">total {fmt(running)}</span></td>
                    <td>{writer && <StepForm action={removeScheduleItem} id={i.id} to="REMOVE" label="Remove" />}</td></tr>
                );
              }); })()}</tbody>
            </table></div>
          )}
        </section>
      </div>

      <Attachments entity="Subcontract" id={s.id} user={user} title="Contract and valuation documents" hint="The signed contract, measurement sheets and the subcontractor's payment applications." />

      {ledgerIds.length > 0 && <section className="panel"><h2>Ledger entries</h2><JournalFor sourceIds={ledgerIds} /></section>}
      <section className="panel"><h2>History</h2><AuditFor entity="Subcontract" ids={[s.id]} /></section>
    </>
  );
}
