import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { payPayroll, transitionPayroll, updatePayrollLine } from "@/actions/workforce";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { AuditFor, JournalFor } from "@/components/RecordParts";
import { Field, Kpi, PageHead, Pill, clean } from "@/components/ui";
import { METHOD_LABEL } from "@/lib/domain";
import { D, fmt2, fmtDate, sum, toDateInput, ZERO } from "@/lib/money";
import { advanceBalances } from "@/lib/workforce";

const cellInput = { width: 86, padding: "5px 7px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" } as const;

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("payroll");
  const { id } = await params;
  const r = await db.payrollRun.findUnique({
    where: { id },
    include: { lines: { include: { employee: true, allocations: { include: { project: true } } }, orderBy: { employee: { code: "asc" } } } },
  });
  if (!r) notFound();

  const writer = canWrite(user.role, "payroll");
  const isFinance = APPROVERS.includes(user.role);
  const draft = r.status === "DRAFT";
  const accounts = await db.account.findMany({ where: { isCash: true, active: true }, orderBy: { code: "asc" } });
  const owed = await advanceBalances(db, r.lines.map((l) => l.employeeId));

  const gross = sum(r.lines.map((l) => l.gross)), net = sum(r.lines.map((l) => l.net));
  const deductions = sum(r.lines.map((l) => l.deductions)), advances = sum(r.lines.map((l) => l.advanceRecovered));

  // Cost by project, so it is clear where this payroll lands in the project figures.
  const byProject = new Map<string, { label: string; amount: ReturnType<typeof D> }>();
  for (const a of r.lines.flatMap((l) => l.allocations)) {
    const key = a.projectId ?? "overhead";
    const cur = byProject.get(key) ?? { label: a.project ? `${a.project.code} ${clean(a.project.name)}` : "Office and yard (overhead)", amount: ZERO };
    byProject.set(key, { ...cur, amount: cur.amount.plus(a.amount) });
  }

  return (
    <>
      <PageHead title={r.number} sub={`${fmtDate(r.periodStart)} to ${fmtDate(r.periodEnd)}`}>
        <Pill status={r.status} />
        {(r.status === "APPROVED" || r.status === "PAID") && <a className="btn" href={`/api/pdf/payroll/${r.id}`} target="_blank" rel="noreferrer">Payslips PDF</a>}
        <Link className="btn" href="/payroll">All payroll</Link>
      </PageHead>

      <section className="kpis">
        <Kpi label="Gross pay" value={fmt2(gross)} sub={`${r.lines.length} people`} />
        <Kpi label="Deductions" value={fmt2(deductions)} />
        <Kpi label="Advances recovered" value={fmt2(advances)} />
        <Kpi label="Net to pay" value={fmt2(net)} sub={r.status === "PAID" ? `Paid ${fmtDate(r.paidAt)}${r.payMethod ? " by " + METHOD_LABEL[r.payMethod] : ""}` : undefined} />
      </section>

      {r.notes && <div className="notice">{r.notes}</div>}

      <div className="row">
        {draft && isFinance && <StepForm action={transitionPayroll} id={r.id} to="APPROVE" label="Approve payroll" primary />}
        {draft && !isFinance && <span className="muted small">Waiting for finance to approve.</span>}
        {r.status !== "VOID" && isFinance && <StepForm action={transitionPayroll} id={r.id} to="VOID" label="Void payroll" ask="Reason for voiding" danger />}
      </div>

      {r.status === "APPROVED" && isFinance && (
        <section className="panel">
          <h2>Pay staff</h2>
          <ActionForm action={payPayroll}>
            <input type="hidden" name="id" value={r.id} />
            <div className="fields three">
              <Field name="date" label="Date paid"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} /></Field>
              <Field name="accountId" label="Paid from"><select id="accountId" name="accountId" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field name="method" label="Method"><select id="method" name="method" required defaultValue="CASH">{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field name="reference" label="Reference"><input id="reference" name="reference" placeholder="Batch or transfer number" /></Field>
            </div>
            <div className="row"><Submit>{`Pay ${fmt2(net)}`}</Submit></div>
          </ActionForm>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>Payslips</h2>{draft && writer && <span className="small muted">Add a bonus, a deduction, or take back part of an advance, then save the row.</span>}</div>
        <div className="tablewrap"><table>
          <thead><tr><th>Employee</th><th className="r">Days</th><th className="r">Base</th><th className="r">Overtime</th><th className="r">Bonus</th><th className="r">Deductions</th><th className="r">Advance back</th><th className="r">Net</th></tr></thead>
          <tbody>{r.lines.map((l) => (
            <tr key={l.id}>
              <td><b>{clean(l.employee.name)}</b><br /><span className="small muted">{l.employee.payType === "DAILY" ? "Daily wage" : "Monthly salary"} · {l.employee.code}</span></td>
              <td className="r num">{String(l.paidDays)}</td>
              <td className="r num">{fmt2(l.basePay)}</td>
              <td className="r num">{fmt2(l.overtimePay)}<br /><span className="small muted">{String(l.overtimeHours)} h</span></td>
              {draft && writer ? (
                <td colSpan={4}>
                  <ActionForm action={updatePayrollLine} className="inline-form">
                    <input type="hidden" name="lineId" value={l.id} />
                    <input name="bonus" type="number" min="0" step="0.01" defaultValue={l.bonus.toString()} aria-label={`Bonus for ${l.employee.name}`} style={cellInput} />
                    <input name="deductions" type="number" min="0" step="0.01" defaultValue={l.deductions.toString()} aria-label={`Deductions for ${l.employee.name}`} style={cellInput} />
                    <input name="advanceRecovered" type="number" min="0" step="0.01" defaultValue={l.advanceRecovered.toString()} aria-label={`Advance recovered from ${l.employee.name}`} style={cellInput} title={`Owes ${fmt2(owed.get(l.employeeId))}`} />
                    <Submit className="btn sm">Save</Submit>
                    <span className="num" style={{ marginLeft: "auto" }}>{fmt2(l.net)}</span>
                  </ActionForm>
                  {owed.get(l.employeeId)?.greaterThan(0) && <span className="small muted">Owes {fmt2(owed.get(l.employeeId))} in advances</span>}
                </td>
              ) : (
                <>
                  <td className="r num">{fmt2(l.bonus)}</td><td className="r num">{fmt2(l.deductions)}</td><td className="r num">{fmt2(l.advanceRecovered)}</td>
                  <td className="r num"><b>{fmt2(l.net)}</b></td>
                </>
              )}
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td /><td className="r num">{fmt2(sum(r.lines.map((l) => l.basePay)))}</td><td className="r num">{fmt2(sum(r.lines.map((l) => l.overtimePay)))}</td><td className="r num">{fmt2(sum(r.lines.map((l) => l.bonus)))}</td><td className="r num">{fmt2(deductions)}</td><td className="r num">{fmt2(advances)}</td><td className="r num">{fmt2(net)}</td></tr></tfoot>
        </table></div>
      </section>

      <div className="grid2 even">
        <section className="panel">
          <h2>Labour cost by project</h2>
          <div className="tablewrap"><table>
            <tbody>{[...byProject.values()].sort((a, b) => b.amount.comparedTo(a.amount)).map((p) => <tr key={p.label}><td>{p.label}</td><td className="r num">{fmt2(p.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td>Gross wages</td><td className="r num">{fmt2(gross)}</td></tr></tfoot>
          </table></div>
          <span className="small muted">Counted in each project&apos;s costs once the payroll is approved.</span>
        </section>
        <section className="panel"><h2>History</h2><AuditFor entity="PayrollRun" ids={[r.id]} /></section>
      </div>

      {r.status !== "DRAFT" && <section className="panel"><h2>Ledger entries</h2><JournalFor sourceIds={[r.id]} /></section>}
    </>
  );
}
