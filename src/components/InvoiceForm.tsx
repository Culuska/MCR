import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { projectWhere, scopeOf } from "@/lib/scope";
import { saveInvoice } from "@/actions/invoices";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { toDateInput } from "@/lib/money";
import type { Invoice } from "@/generated/prisma/client";

export async function InvoiceForm({ invoice, projectId }: { invoice?: Invoice; projectId?: string }) {
  const scope = await scopeOf(await requireUser());
  const [customers, projects] = await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { status: { not: "CANCELLED" }, ...projectWhere(scope) }, orderBy: { code: "asc" }, include: { customer: true } }),
  ]);
  const preset = projects.find((p) => p.id === (invoice?.projectId ?? projectId));
  const due = new Date(); due.setDate(due.getDate() + 30);
  return (
    <ActionForm action={saveInvoice} goTo={invoice ? `/invoices/${invoice.id}` : "/invoices"}>
      {invoice && <input type="hidden" name="id" value={invoice.id} />}
      <div className="panel">
        <div className="fields">
          <Field name="projectId" label="Project">
            <select id="projectId" name="projectId" required defaultValue={preset?.id ?? ""}>
              <option value="" disabled>Choose…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name.replace(" (sample)", "")}</option>)}
            </select>
          </Field>
          <Field name="customerId" label="Customer" hint="Must match the project's customer.">
            <select id="customerId" name="customerId" required defaultValue={invoice?.customerId ?? preset?.customerId ?? ""}>
              <option value="" disabled>Choose…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field name="issueDate" label="Issue date"><input id="issueDate" name="issueDate" type="date" required defaultValue={toDateInput(invoice?.issueDate ?? new Date())} /></Field>
          <Field name="dueDate" label="Due date"><input id="dueDate" name="dueDate" type="date" required defaultValue={toDateInput(invoice?.dueDate ?? due)} /></Field>
          <Field name="amount" label="Amount (USD)"><input id="amount" name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" required defaultValue={invoice?.amount.toString()} /></Field>
          <Field name="notes" label="Description" wide><textarea id="notes" name="notes" defaultValue={invoice?.notes ?? ""} placeholder="Interim payment certificate no. 3, foundations complete" /></Field>
        </div>
      </div>
      <div className="row"><Submit>{invoice ? "Save draft" : "Save as draft"}</Submit><span className="hint">Revenue is recorded when you issue the invoice.</span></div>
    </ActionForm>
  );
}
