import Link from "next/link";
import { db } from "@/lib/db";
import { resetWithToken } from "@/actions/password";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { POLICY_TEXT } from "@/lib/password-policy";
import { hashToken, looksLikeToken, resetState } from "@/lib/reset-token";

export const metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPassword({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The page only says whether the link can still be used. Why it cannot is not spelled out.
  const row = looksLikeToken(token) ? await db.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { active: true } } } }) : null;
  const valid = resetState(row) === "valid" && row!.user.active;
  return (
    <div className="login">
      <div className="box">
        <div>
          <h1>MCR Finance</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>Choose a new password</p>
        </div>
        <div className="panel">
          {valid ? (
            <ActionForm action={resetWithToken}>
              <input type="hidden" name="token" value={token} />
              <Field name="password" label="New password" hint={POLICY_TEXT}><input id="password" name="password" type="password" autoComplete="new-password" required autoFocus /></Field>
              <Field name="confirm" label="Confirm new password"><input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
              <Submit>Change password</Submit>
            </ActionForm>
          ) : (
            <>
              <div className="notice error" role="alert">This reset link is not valid or has expired.</div>
              <p className="small" style={{ marginBottom: 0 }}><Link href="/forgot-password">Request a new link</Link> · <Link href="/login">Back to sign in</Link></p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
