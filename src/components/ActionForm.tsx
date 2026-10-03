"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/action";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function Submit({ children, className = "btn primary" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending}>{pending ? "Working…" : children}</button>;
}

// Wraps a server action: shows its error or success message and can move on after a save.
export function ActionForm({ action, children, className = "form", goTo, goToPrefix, resetOnOk }: {
  action: Action; children: React.ReactNode; className?: string; goTo?: string; resetOnOk?: boolean;
  /** When the action answers "message|id", open goToPrefix + id (used after creating a record). */
  goToPrefix?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [message, newId] = state?.ok?.split("|") ?? [];
  useEffect(() => {
    if (state?.ok && goTo) router.push(goTo);
    else if (newId && goToPrefix) router.push(goToPrefix + newId);
    else if (state?.ok && resetOnOk) formRef.current?.reset(); // clears the fields but keeps the success message visible
  }, [state, goTo, goToPrefix, newId, resetOnOk, router]);
  return (
    <form ref={formRef} action={formAction} className={className}>
      {children}
      {state?.error && <div className="notice error" role="alert">{state.error}</div>}
      {state?.ok && !goTo && !(newId && goToPrefix) && <div className="notice ok" role="status">{message}</div>}
    </form>
  );
}

// A one-click workflow button (Submit, Approve…) that can also ask for a reason.
export function StepForm({ action, id, to, label, ask, primary, danger, extra }: {
  action: Action; id: string; to: string; label: string; ask?: string; primary?: boolean; danger?: boolean; extra?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {ask && <input name="reason" placeholder={ask} required aria-label={ask} style={{ padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit", minWidth: 180 }} />}
      <Submit className={`btn sm${primary ? " primary" : ""}${danger ? " danger" : ""}`}>{label}</Submit>
      {state?.error && <span className="small" style={{ color: "var(--bad)" }} role="alert">{state.error}</span>}
      {state?.ok && <span className="small" style={{ color: "var(--good)" }} role="status">{state.ok}</span>}
    </form>
  );
}
