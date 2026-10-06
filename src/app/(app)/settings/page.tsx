import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { createUser, resetPassword, updateUser } from "@/actions/users";
import { sendResetLink } from "@/actions/password";
import { SecurityTab } from "@/components/SecurityTab";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Empty, Field, PageHead, Tabs } from "@/components/ui";
import { Role } from "@/generated/prisma/enums";

export const metadata = { title: "Settings" };

const TABS = [{ key: "audit", label: "Audit trail", href: "/settings" }, { key: "people", label: "People and roles", href: "/settings?tab=people" }, { key: "security", label: "Security", href: "/settings?tab=security" }];

export default async function Settings({ searchParams }: { searchParams: Promise<{ entity?: string; tab?: string }> }) {
  await requireRead("settings");
  const { entity, tab } = await searchParams;
  const current = tab === "people" ? "people" : tab === "security" ? "security" : "audit";
  return (
    <>
      <PageHead title="Settings" sub={current === "audit" ? "Who did what, and when. Entries cannot be edited or removed from the app." : current === "security" ? "How sign-in is protected, who is paused, and recent sign-ins and password resets." : "Who can sign in, and what each person can do."} />
      <Tabs items={TABS} current={current} />
      {current === "audit" ? <AuditTab entity={entity} /> : current === "security" ? <SecurityTab /> : <PeopleTab />}
    </>
  );
}

async function AuditTab({ entity }: { entity?: string }) {
  const rows = await db.auditLog.findMany({ where: { entity: entity || undefined, action: { not: "auth.login" } }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <>
      <form className="filters" action="/settings">
        <select name="entity" defaultValue={entity ?? ""} aria-label="Record type">
          <option value="">All records</option>{["Expense", "Invoice", "Payment", "Project", "Customer", "Supplier", "User"].map((e) => <option key={e}>{e}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
      </form>
      <section className="panel">
        {rows.length === 0 ? <Empty title="No activity yet" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>What happened</th><th>Record</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{r.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{r.summary}</td><td className="muted">{r.entity}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

async function PeopleTab() {
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return (
    <>
      <details className="more">
        <summary>Add a person</summary>
        <div className="body">
          <ActionForm action={createUser} resetOnOk>
            <div className="fields">
              <Field name="name" label="Full name"><input id="name" name="name" required /></Field>
              <Field name="email" label="Email (used to sign in)"><input id="email" name="email" type="email" required autoComplete="off" /></Field>
              <Field name="role" label="Role">
                <select id="role" name="role" required defaultValue="VIEWER">{Object.values(Role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              </Field>
              <Field name="password" label="Starting password" hint="At least 12 characters with upper and lower case, a number and a symbol. Share it privately; they can change it under Account, or use Forgot password."><input id="password" name="password" type="password" minLength={12} required autoComplete="new-password" /></Field>
            </div>
            <div className="row"><Submit>Add person</Submit></div>
          </ActionForm>
        </div>
      </details>

      <section className="panel">
        <div style={{ display: "grid", gap: 14 }}>
          {users.map((u) => (
            <div key={u.id} style={{ display: "grid", gap: 8, paddingBottom: 14, borderBottom: "1px solid var(--line)", opacity: u.active ? 1 : 0.65 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><b>{u.name}</b> {!u.active && <span className="pill bad">Inactive</span>}<br /><span className="small muted">{u.email}</span></div>
                <ActionForm action={updateUser} className="inline-form">
                  <input type="hidden" name="id" value={u.id} />
                  <select name="role" defaultValue={u.role} aria-label={`Role for ${u.name}`} style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }}>
                    {Object.values(Role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <select name="active" defaultValue={u.active ? "on" : "off"} aria-label={`Status for ${u.name}`} style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit" }}>
                    <option value="on">Active</option><option value="off">Inactive</option>
                  </select>
                  <Submit className="btn sm">Save</Submit>
                </ActionForm>
              </div>
              <ActionForm action={sendResetLink} className="inline-form">
                <input type="hidden" name="id" value={u.id} />
                <Submit className="btn sm">Email reset link</Submit>
              </ActionForm>
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>Set a temporary password instead</summary>
                <ActionForm action={resetPassword} className="inline-form" resetOnOk>
                  <input type="hidden" name="id" value={u.id} />
                  <input name="password" type="password" minLength={12} required autoComplete="new-password" placeholder="New password, 12+ characters" aria-label={`New password for ${u.name}`} style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit", minWidth: 240 }} />
                  <Submit className="btn sm">Set password</Submit>
                </ActionForm>
              </details>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
