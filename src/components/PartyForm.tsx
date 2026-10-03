import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import type { FormState } from "@/lib/action";

type Party = { id: string; name: string; type?: string | null; contact: string | null; phone: string | null; email: string | null; address: string | null; paymentTerms?: string | null };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const CUSTOMER_TYPES = ["Government", "NGO / UN agency", "Private company", "Individual / diaspora"];

export function PartyForm({ action, party, kind, goTo }: { action: Action; party?: Party; kind: "customer" | "supplier"; goTo: string }) {
  return (
    <ActionForm action={action} goTo={goTo} resetOnOk>
      {party && <input type="hidden" name="id" value={party.id} />}
      <div className="fields">
        <Field name="name" label={kind === "customer" ? "Customer name" : "Supplier name"} wide><input id="name" name="name" required defaultValue={party?.name} /></Field>
        {kind === "customer" && (
          <Field name="type" label="Type">
            <select id="type" name="type" defaultValue={party?.type ?? ""}><option value="">Not set</option>{CUSTOMER_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </Field>
        )}
        {kind === "supplier" && <Field name="paymentTerms" label="Payment terms"><input id="paymentTerms" name="paymentTerms" defaultValue={party?.paymentTerms ?? ""} placeholder="30 days" /></Field>}
        <Field name="contact" label="Contact person"><input id="contact" name="contact" defaultValue={party?.contact ?? ""} /></Field>
        <Field name="phone" label="Phone"><input id="phone" name="phone" defaultValue={party?.phone ?? ""} /></Field>
        <Field name="email" label="Email"><input id="email" name="email" type="email" defaultValue={party?.email ?? ""} /></Field>
        <Field name="address" label="Address" wide><input id="address" name="address" defaultValue={party?.address ?? ""} /></Field>
      </div>
      <div className="row"><Submit>{party ? "Save changes" : `Add ${kind}`}</Submit></div>
    </ActionForm>
  );
}
