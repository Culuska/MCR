"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteRecord } from "@/actions/delete";
import { Submit } from "@/components/ActionForm";

// A Delete button that asks twice: the first click opens a reason box, the second click deletes.
// After a delete it goes to `redirectTo` (used on a record's own page) or just refreshes the list.
export function DeleteButton({ kind, id, name, redirectTo }: { kind: string; id: string; name: string; redirectTo?: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(deleteRecord, undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok && !redirectTo) router.refresh(); }, [state, redirectTo, router]);

  if (!open) return <button type="button" className="btn sm danger" onClick={() => setOpen(true)}>Delete</button>;
  return (
    <form action={formAction} className="inline-form" aria-label={`Delete ${name}`}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      <input name="reason" placeholder="Why delete it?" required minLength={3} aria-label={`Reason for deleting ${name}`} autoFocus
        style={{ padding: "5px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-2)", color: "inherit", minWidth: 170 }} />
      <Submit className="btn sm danger">Delete permanently</Submit>
      <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
      {state?.error && <span className="small" style={{ color: "var(--bad)" }} role="alert">{state.error}</span>}
      {state?.ok && <span className="small" style={{ color: "var(--good)" }} role="status">{state.ok}</span>}
    </form>
  );
}
