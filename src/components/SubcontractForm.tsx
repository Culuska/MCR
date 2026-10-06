import { db } from "@/lib/db";
import { currentScope, projectWhere } from "@/lib/scope";
import { saveSubcontract } from "@/actions/subcontracts";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field, clean } from "@/components/ui";
import { toDateInput } from "@/lib/money";
import type { Subcontract } from "@/generated/prisma/client";

export async function SubcontractForm({ subcontract }: { subcontract?: Subcontract }) {
  const [suppliers, projects] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, ...projectWhere(await currentScope()) }, orderBy: { code: "asc" } }),
  ]);
  return (
    <ActionForm action={saveSubcontract} goToPrefix="/subcontracts/">
      {subcontract && <input type="hidden" name="id" value={subcontract.id} />}
      <div className="fields">
        <Field name="supplierId" label="Subcontractor" hint="Add them under Suppliers first if they are not listed.">
          <select id="supplierId" name="supplierId" required defaultValue={subcontract?.supplierId ?? ""}>
            <option value="" disabled>Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field name="projectId" label="Project">
          <select id="projectId" name="projectId" required defaultValue={subcontract?.projectId ?? ""}>
            <option value="" disabled>Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {clean(p.name)}</option>)}
          </select>
        </Field>
        <Field name="scope" label="Scope of work" wide><input id="scope" name="scope" required minLength={5} defaultValue={subcontract?.scope} placeholder="Electrical first and second fix, clinic building" /></Field>
        <Field name="contractValue" label="Contract value (USD)"><input id="contractValue" name="contractValue" type="number" step="0.01" min="0.01" required defaultValue={subcontract?.contractValue.toString()} /></Field>
        <Field name="retentionPct" label="Retention held back (%)" hint="Withheld from every payment and released after completion."><input id="retentionPct" name="retentionPct" type="number" step="0.01" min="0" max="20" required defaultValue={subcontract?.retentionPct.toString() ?? "5"} /></Field>
        <Field name="startDate" label="Start date"><input id="startDate" name="startDate" type="date" defaultValue={toDateInput(subcontract?.startDate)} /></Field>
        <Field name="endDate" label="Planned finish"><input id="endDate" name="endDate" type="date" defaultValue={toDateInput(subcontract?.endDate)} /></Field>
        <Field name="notes" label="Notes" wide><input id="notes" name="notes" defaultValue={subcontract?.notes ?? ""} /></Field>
      </div>
      <div className="row"><Submit>{subcontract ? "Save draft" : "Create draft"}</Submit><span className="hint">A draft has no effect on the books until finance signs it off.</span></div>
    </ActionForm>
  );
}
