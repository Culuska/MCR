import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { login } from "@/actions/auth";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await getUser()) redirect("/");
  const { reset } = await searchParams;
  return (
    <div className="login">
      <div className="box">
        <div>
          <h1>MCR Finance</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>Mogadishu Construction and Rehabilitation</p>
        </div>
        {reset === "1" && <div className="notice ok" role="status">Your password was changed. Sign in with the new password.</div>}
        <div className="panel">
          <ActionForm action={login}>
            <Field name="email" label="Email"><input id="email" name="email" type="email" autoComplete="username" required autoFocus /></Field>
            <Field name="password" label="Password"><input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
            <Submit>Sign in</Submit>
            <Link href="/forgot-password" className="small">Forgot password?</Link>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
