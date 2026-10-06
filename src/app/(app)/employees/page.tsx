import Link from "next/link";
import { requireCompanyWide } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { APPROVERS, canWrite } from "@/lib/permissions";
import { giveAdvance, saveEmployee } from "@/actions/workforce";
import { advanceBalances } from "@/lib/workforce";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Empty, Field, PageHead, Pill, Sample, clean } from "@/components/ui";
import { fmt, fmt2, toDateInput } from "@/lib/money";
import { PayType } from "@/generated/prisma/enums";
import type { Employee } from "@/generated/prisma/client";

export const metadata = { title: "Employees" };

export default async function Employees({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await requireRead("payroll");
  await requireCompanyWide(user, "payroll");
  const { edit } = await searchParams;
  const writer = canWrite(user.role, "payroll");
  const isFinance = APPROVERS.includes(user.role);

  const [employees, accounts] = await Promise.all([
    db.employee.findMany({ orderBy: [{ active: "desc" }, { code: "asc" }] }),
    db.account.findMany({ where: { isCash: true, active: true }, orderBy: { code: "asc" } }),
  ]);
  const owed = await advanceBalances(db);
  const editing = edit ? employees.find((e) => e.id === edit) : undefined;

  return (
    <>
      <PageHead title="Employees" sub="Who works for the company and how each person is paid" />

      {writer && (
        <details className="more" open={!!editing}>
          <summary>{editing ? `Edit ${clean(editing.name)}` : "Add an employee"}</summary>
          <div className="body"><EmployeeForm key={editing?.id ?? "new"} employee={editing} /></div>
        </details>
      )}

      {isFinance && employees.length > 0 && (
        <details className="more">
          <summary>Pay an advance</summary>
          <div className="body">
            <ActionForm action={giveAdvance} resetOnOk>
              <div className="fields three">
                <Field name="employeeId" label="Employee"><select id="employeeId" name="employeeId" required defaultValue="">
                  <option value="" disabled>Choose…</option>{employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{clean(e.name)}</option>)}
                </select></Field>
                <Field name="amount" label="Amount (USD)"><input id="amount" name="amount" type="number" step="0.01" min="0.01" required /></Field>
                <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(new Date())} /></Field>
                <Field name="accountId" label="Paid from"><select id="accountId" name="accountId" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field name="note" label="Note" wide><input id="note" name="note" placeholder="Reason for the advance" /></Field>
              </div>
              <div className="row"><Submit>Pay advance</Submit><span className="hint">You choose how much to take back in each payroll run.</span></div>
            </ActionForm>
          </div>
        </details>
      )}

      {employees.length === 0 ? <Empty title="No employees yet">Add your first employee to start recording attendance and paying wages.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Employee</th><th>Position</th><th>Pay</th><th className="r">Rate</th><th className="r">Overtime / hr</th><th className="r">Owes advance</th><th /></tr></thead>
          <tbody>{employees.map((e) => (
            <tr key={e.id} style={e.active ? undefined : { opacity: 0.6 }}>
              <td><b>{clean(e.name)}</b> <Sample name={e.name} /> {!e.active && <span className="pill bad">Inactive</span>}<br /><span className="small muted num">{e.code}{e.phone ? ` · ${e.phone}` : ""}</span></td>
              <td>{e.position}<br /><span className="small muted">{e.department ?? ""}</span></td>
              <td><Pill status="ACTIVE" text={e.payType === "DAILY" ? "Daily wage" : "Monthly salary"} /></td>
              <td className="r num">{fmt2(e.rate)}</td>
              <td className="r num">{e.overtimeRate.isZero() ? "—" : fmt2(e.overtimeRate)}</td>
              <td className={`r num ${owed.get(e.id)?.greaterThan(0) ? "out" : ""}`}>{owed.get(e.id)?.greaterThan(0) ? fmt(owed.get(e.id)) : "—"}</td>
              <td>{writer && <div className="row"><Link className="small" href={`/employees?edit=${e.id}`}>Edit</Link><DeleteButton kind="employee" id={e.id} name={e.name} /></div>}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}
    </>
  );
}

function EmployeeForm({ employee }: { employee?: Employee }) {
  return (
    <ActionForm action={saveEmployee} goTo="/employees" resetOnOk>
      {employee && <input type="hidden" name="id" value={employee.id} />}
      <div className="fields">
        <Field name="name" label="Full name"><input id="name" name="name" required defaultValue={employee?.name} /></Field>
        <Field name="position" label="Position"><input id="position" name="position" required defaultValue={employee?.position} placeholder="Mason, driver, site engineer" /></Field>
        <Field name="department" label="Department"><input id="department" name="department" defaultValue={employee?.department ?? ""} /></Field>
        <Field name="phone" label="Phone"><input id="phone" name="phone" defaultValue={employee?.phone ?? ""} /></Field>
        <Field name="payType" label="How they are paid">
          <select id="payType" name="payType" defaultValue={employee?.payType ?? "DAILY"}>
            <option value={PayType.DAILY}>Daily wage, paid for each day worked</option>
            <option value={PayType.MONTHLY}>Monthly salary, pro-rated from attendance</option>
          </select>
        </Field>
        <Field name="rate" label="Daily wage or monthly salary (USD)"><input id="rate" name="rate" type="number" step="0.01" min="0.01" required defaultValue={employee?.rate.toString()} /></Field>
        <Field name="overtimeRate" label="Overtime per hour (USD)" hint="Leave at 0 if overtime is not paid."><input id="overtimeRate" name="overtimeRate" type="number" step="0.01" min="0" defaultValue={employee?.overtimeRate.toString() ?? "0"} /></Field>
        <Field name="paymentDetails" label="Bank or mobile money details"><input id="paymentDetails" name="paymentDetails" defaultValue={employee?.paymentDetails ?? ""} /></Field>
        {employee && <Field name="active" label="Status"><select id="active" name="active" defaultValue={employee.active ? "on" : "off"}><option value="on">Active</option><option value="off">Inactive</option></select></Field>}
      </div>
      <div className="row"><Submit>{employee ? "Save changes" : "Add employee"}</Submit></div>
    </ActionForm>
  );
}
