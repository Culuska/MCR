import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";
import { POLICY_TEXT } from "@/lib/password-policy";
import { changeOwnPassword, signOutEverywhere } from "@/actions/password";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field, PageHead } from "@/components/ui";
import { fmtDate } from "@/lib/money";

export const metadata = { title: "Account" };

export default async function Account() {
  const me = await requireUser();
  const recent = await db.loginAttempt.findMany({ where: { kind: "login", email: me.email }, orderBy: { createdAt: "desc" }, take: 8 });
  return (
    <>
      <PageHead title="Account" sub={`${me.name} · ${me.email} · ${ROLE_LABEL[me.role]}`} />
      <div className="grid2 even">
        <section className="panel">
          <h2>Change password</h2>
          <ActionForm action={changeOwnPassword} resetOnOk>
            <Field name="current" label="Current password"><input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
            <Field name="password" label="New password" hint={POLICY_TEXT}><input id="password" name="password" type="password" autoComplete="new-password" required /></Field>
            <Field name="confirm" label="Confirm new password"><input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
            <Submit>Change password</Submit>
          </ActionForm>
          <p className="small muted">Changing your password signs you out of every other device.</p>
        </section>
        <section className="panel">
          <h2>Sessions</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Signed in on a shared or lost device? End all sessions, including this one, and sign in again.</p>
          <form action={signOutEverywhere}><button type="submit" className="btn danger">Sign out everywhere</button></form>
          <h2 style={{ marginTop: 22 }}>Recent sign-ins</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>Result</th><th>Address</th></tr></thead>
            <tbody>{recent.map((r) => <tr key={r.id}><td>{fmtDate(r.createdAt)} {r.createdAt.toISOString().slice(11, 16)}</td><td>{r.success ? "Signed in" : "Failed"}</td><td className="muted">{r.ip ?? "unknown"}</td></tr>)}</tbody>
          </table></div>
        </section>
      </div>
    </>
  );
}
