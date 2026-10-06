import Link from "next/link";
import { db } from "@/lib/db";
import { emailStatus } from "@/lib/email";
import { POLICY_TEXT } from "@/lib/password-policy";
import { MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP, RESET_REQUESTS_PER_HOUR_EMAIL, WINDOW_MS, lockout, minutes } from "@/lib/throttle";
import { resetState } from "@/lib/reset-token";
import { appUrl } from "@/lib/request";
import { Empty } from "@/components/ui";

const when = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;

// Settings, Security: what protects the sign-in, who is paused right now, and the recent sign-in and reset history.
// Secrets are never shown here: email passwords live only in environment variables.
export async function SecurityTab() {
  const now = new Date();
  const email = emailStatus();
  const url = appUrl();
  const since = new Date(now.getTime() - WINDOW_MS);
  const [attempts, failed, resets] = await Promise.all([
    db.loginAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    db.loginAttempt.findMany({ where: { kind: "login", success: false, reason: { not: "locked" }, createdAt: { gt: since } }, select: { email: true, createdAt: true } }),
    db.passwordReset.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true, email: true } } } }),
  ]);
  const byEmail = new Map<string, Date[]>();
  for (const f of failed) byEmail.set(f.email, [...(byEmail.get(f.email) ?? []), f.createdAt]);
  const paused = [...byEmail].map(([e, ds]) => ({ e, v: lockout(ds, MAX_FAILURES_PER_EMAIL, now) })).filter((p) => p.v.locked);

  return (
    <>
      <div className="grid2 even">
        <section className="panel">
          <h2>Email for password resets</h2>
          {email.configured ? <span className="pill good">Set up</span> : <span className="pill bad">Not set up</span>}
          {email.configured ? (
            <table style={{ marginTop: 10 }}><tbody>
              <tr><td className="muted">Mail server</td><td>{email.host}:{email.port}</td></tr>
              <tr><td className="muted">Sender</td><td>{email.fromName} &lt;{email.from}&gt;</td></tr>
              <tr><td className="muted">Account</td><td>{email.user}</td></tr>
            </tbody></table>
          ) : (
            <p className="small">Reset emails cannot be sent yet. Add these in Vercel, Settings, Environment Variables, then redeploy: <code>EMAIL_HOST</code>, <code>EMAIL_PORT</code>, <code>EMAIL_USER</code>, <code>EMAIL_PASSWORD</code>, <code>EMAIL_FROM</code>, <code>EMAIL_FROM_NAME</code>. Missing now: <b>{email.missing.join(", ")}</b>.</p>
          )}
          <p className="small" style={{ marginBottom: 0 }}>
            Links in emails open <b>{url ?? "(APP_URL is not set)"}</b>. {url ? "" : <span style={{ color: "var(--bad)" }}>Set APP_URL to your site address, for example https://www.mcrltd.app, or no reset emails are sent.</span>} Passwords and keys are read from the server settings only and are never shown or stored in the app.
          </p>
        </section>
        <section className="panel">
          <h2>Sign-in protection</h2>
          <table><tbody>
            <tr><td className="muted">Password rule</td><td>{POLICY_TEXT}</td></tr>
            <tr><td className="muted">Failed sign-ins</td><td>After {MAX_FAILURES_PER_EMAIL} failures for one email, or {MAX_FAILURES_PER_IP} from one address, sign-in is paused for {minutes(WINDOW_MS / 1000)} minutes. It ends by itself.</td></tr>
            <tr><td className="muted">Reset links</td><td>Work once, expire after 30 minutes, and only {RESET_REQUESTS_PER_HOUR_EMAIL} can be requested per email per hour.</td></tr>
            <tr><td className="muted">Sessions</td><td>12 hours. A password change ends all other sessions.</td></tr>
          </tbody></table>
          <h3 style={{ margin: "14px 0 6px", fontSize: 14 }}>Paused right now</h3>
          {paused.length === 0 ? <span className="small muted">No one.</span> : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{paused.map((p) => <li key={p.e}>{p.e}, about {p.v.locked ? minutes(p.v.retryAfterSec) : 0} minute(s) left</li>)}</ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Sign-in history</h2>
        {attempts.length === 0 ? <Empty title="Nothing yet" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>When</th><th>Email</th><th>What</th><th>Result</th><th>Address</th></tr></thead>
            <tbody>{attempts.map((a) => (
              <tr key={a.id}>
                <td className="small">{when(a.createdAt)}</td><td>{a.email}</td><td>{a.kind === "reset" ? "Reset request" : "Sign-in"}</td>
                <td>{a.success ? <span className="pill good">OK</span> : <span className="pill bad">{a.reason === "locked" ? "Paused" : "Failed"}</span>} <span className="small muted">{a.reason}</span></td>
                <td className="small muted">{a.ip ?? "unknown"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
        <h2>Password reset history</h2>
        {resets.length === 0 ? <Empty title="No reset links yet" /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Requested</th><th>Account</th><th>Status</th><th>Address</th></tr></thead>
            <tbody>{resets.map((r) => {
              const st = resetState(r, now);
              return <tr key={r.id}><td className="small">{when(r.createdAt)}</td><td>{r.user.name} <span className="small muted">{r.user.email}</span></td>
                <td>{st === "valid" ? <span className="pill warn">Waiting</span> : st === "used" ? <span className="pill good">Used or replaced</span> : <span className="pill bad">Expired</span>}</td><td className="small muted">{r.requestedIp ?? "unknown"}</td></tr>;
            })}</tbody>
          </table></div>
        )}
        <p className="small muted">Every sign-in problem, lockout, reset and password change is also in the <Link href="/settings">audit trail</Link>, with the address it came from.</p>
      </section>
    </>
  );
}
