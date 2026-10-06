import Link from "next/link";
import { requestReset } from "@/actions/password";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";

export const metadata = { title: "Forgot password" };

export default function ForgotPassword() {
  return (
    <div className="login">
      <div className="box">
        <div>
          <h1>MCR Finance</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>Reset your password</p>
        </div>
        <div className="panel">
          <p className="small muted" style={{ marginTop: 0 }}>Enter the email address of your account. If it is registered, we will email you a link to choose a new password. The link works once and expires in 30 minutes.</p>
          <ActionForm action={requestReset}>
            <Field name="email" label="Email"><input id="email" name="email" type="email" autoComplete="username" required autoFocus /></Field>
            <Submit>Send reset link</Submit>
            <Link href="/login" className="small">Back to sign in</Link>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
