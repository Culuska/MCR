import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { projectWhere, scopeOf } from "@/lib/scope";
import { saveExpense } from "@/actions/expenses";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { CATEGORY_LABEL, MANUAL_CATEGORIES, METHOD_LABEL } from "@/lib/domain";
import { toDateInput } from "@/lib/money";
import type { Expense } from "@/generated/prisma/client";

export async function ExpenseForm({ expense, projectId }: { expense?: Expense; projectId?: string }) {
  const user = await requireUser();
  const scope = await scopeOf(user);
  const [projects, suppliers, assets, tasks] = await Promise.all([
    db.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, ...projectWhere(scope) }, orderBy: { code: "asc" } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.asset.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.task.findMany({ where: { status: { notIn: ["DONE", "CANCELLED"] }, ...(scope.all ? {} : { projectId: { in: scope.ids } }) }, include: { project: true }, orderBy: [{ project: { code: "asc" } }, { number: "asc" }] }),
  ]);
  return (
    <ActionForm action={saveExpense} goTo={expense ? `/expenses/${expense.id}` : "/expenses"}>
      {expense && <input type="hidden" name="id" value={expense.id} />}
      <div className="panel">
        <div className="fields">
          <Field name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={toDateInput(expense?.date ?? new Date())} /></Field>
          <Field name="amount" label="Amount (USD)"><input id="amount" name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" required defaultValue={expense?.amount.toString()} /></Field>
          <Field name="projectId" label="Project" hint={scope.all ? "Leave on overhead for office rent, utilities and other company costs." : "Choose the project this cost belongs to."}>
            <select id="projectId" name="projectId" required={!scope.all} defaultValue={expense?.projectId ?? projectId ?? ""}>
              {scope.all ? <option value="">General overhead (no project)</option> : <option value="" disabled>Choose a project</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name.replace(" (sample)", "")}</option>)}
            </select>
          </Field>
          <Field name="category" label="Category">
            <select id="category" name="category" required defaultValue={expense?.category ?? ""}>
              <option value="" disabled>Choose…</option>
              {MANUAL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field name="supplierId" label="Supplier">
            <select id="supplierId" name="supplierId" defaultValue={expense?.supplierId ?? ""}>
              <option value="">No supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field name="assetId" label="Machine or vehicle" hint="For fuel, repairs and hire. It adds the cost to that asset's running cost.">
            <select id="assetId" name="assetId" defaultValue={expense?.assetId ?? ""}>
              <option value="">Not for a specific asset</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.registration ? ` (${a.registration})` : ""}</option>)}
            </select>
          </Field>
          <Field name="taskId" label="Site task" hint="Optional. Must be a task on the project chosen above.">
            <select id="taskId" name="taskId" defaultValue={expense?.taskId ?? ""}>
              <option value="">Not for a specific task</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.project.code} · {t.number} {t.title}</option>)}
            </select>
          </Field>
          <Field name="payee" label="Payee, if not a listed supplier"><input id="payee" name="payee" defaultValue={expense?.payee ?? ""} /></Field>
          <Field name="paymentMethod" label="Expected payment method">
            <select id="paymentMethod" name="paymentMethod" defaultValue={expense?.paymentMethod ?? ""}>
              <option value="">Not decided</option>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field name="description" label="Description" wide><input id="description" name="description" required minLength={3} defaultValue={expense?.description} placeholder="Cement, 200 bags, delivered to site" /></Field>
          <Field name="notes" label="Notes" wide><textarea id="notes" name="notes" defaultValue={expense?.notes ?? ""} /></Field>
        </div>
      </div>
      <div className="row"><Submit>{expense ? "Save draft" : "Save as draft"}</Submit><span className="hint">Submit it for approval from the next page.</span></div>
    </ActionForm>
  );
}
