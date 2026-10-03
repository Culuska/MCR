import Link from "next/link";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { createPayrollRun } from "@/actions/workforce";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Empty, Field, Kpi, PageHead, Pill } from "@/components/ui";
import { fmt, fmtDate, sum, toDateInput } from "@/lib/money";
import { suggestedPeriod } from "@/lib/workforce";

export const metadata = { title: "Payroll" };

export default async function Payroll() {
  const user = await requireRead("payroll");
  const writer = canWrite(user.role, "payroll");
  const runs = await db.payrollRun.findMany({ orderBy: { periodEnd: "desc" }, include: { lines: true } });

  const lastEnd = runs.filter((r) => r.status !== "VOID").map((r) => r.periodEnd).sort((a, b) => b.getTime() - a.getTime())[0];
  const { start, end } = suggestedPeriod(lastEnd);

  const live = runs.filter((r) => r.status !== "VOID");
  const unpaid = live.filter((r) => r.status === "DRAFT" || r.status === "APPROVED");
  const owed = sum(live.filter((r) => r.status === "APPROVED").flatMap((r) => r.lines.map((l) => l.net)));

  return (
    <>
      <PageHead title="Payroll" sub="Wages worked out from attendance, then approved and paid" />

      <section className="kpis">
        <Kpi label="Wages owed now" value={fmt(owed)} sub="Approved, not yet paid" />
        <Kpi label="Paid to date" value={fmt(sum(live.filter((r) => r.status === "PAID").flatMap((r) => r.lines.map((l) => l.net))))} sub="Net pay across all runs" />
        <Kpi label="Waiting on you" value={String(unpaid.length)} sub="Draft or approved runs" />
        <Kpi label="Runs" value={String(live.length)} sub={`${runs.length - live.length} voided`} />
      </section>

      {writer && (
        <details className="more" open={runs.length === 0}>
          <summary>Prepare payroll</summary>
          <div className="body">
            <ActionForm action={createPayrollRun} goToPrefix="/payroll/">
              <div className="fields three">
                <Field name="periodStart" label="Period start"><input id="periodStart" name="periodStart" type="date" required defaultValue={toDateInput(start)} /></Field>
                <Field name="periodEnd" label="Period end"><input id="periodEnd" name="periodEnd" type="date" required defaultValue={toDateInput(end)} /></Field>
                <Field name="notes" label="Note"><input id="notes" name="notes" placeholder="Optional" /></Field>
              </div>
              <div className="row"><Submit>Calculate pay</Submit><span className="hint">Everyone with attendance in the period is included. You can add bonuses and deductions before approving.</span></div>
            </ActionForm>
          </div>
        </details>
      )}

      {runs.length === 0 ? <Empty title="No payroll yet">Record attendance first, then prepare the first payroll run.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Run</th><th>Period</th><th>Status</th><th className="r">People</th><th className="r">Gross</th><th className="r">Net pay</th></tr></thead>
          <tbody>{runs.map((r) => (
            <tr key={r.id} className="link">
              <td><Link href={`/payroll/${r.id}`}><b>{r.number}</b></Link></td>
              <td className="num">{fmtDate(r.periodStart)} to {fmtDate(r.periodEnd)}</td>
              <td><Pill status={r.status} /></td>
              <td className="r num">{r.lines.length}</td>
              <td className="r num">{fmt(sum(r.lines.map((l) => l.gross)))}</td>
              <td className="r num">{fmt(sum(r.lines.map((l) => l.net)))}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}
