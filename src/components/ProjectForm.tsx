import { db } from "@/lib/db";
import { saveProject } from "@/actions/projects";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { CATEGORY_LABEL, MANUAL_CATEGORIES, label } from "@/lib/domain";
import { toDateInput } from "@/lib/money";
import { ProjectStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

type P = Prisma.ProjectGetPayload<{ include: { budget: true } }>;

export async function ProjectForm({ project }: { project?: P }) {
  const [customers, managers] = await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true, role: { in: ["PROJECT_MANAGER", "SUPER_ADMIN", "FINANCE_MANAGER"] } }, orderBy: { name: "asc" } }),
  ]);
  const b = new Map(project?.budget.map((x) => [x.category, x.amount.toString()]));
  return (
    <ActionForm action={saveProject} goTo={project ? `/projects/${project.id}` : undefined}>
      {project && <input type="hidden" name="id" value={project.id} />}
      <div className="panel">
        <h2>Project</h2>
        <div className="fields">
          <Field name="code" label="Project code"><input id="code" name="code" required defaultValue={project?.code} placeholder="MCR-2026-04" /></Field>
          <Field name="name" label="Project name"><input id="name" name="name" required defaultValue={project?.name} /></Field>
          <Field name="customerId" label="Customer">
            <select id="customerId" name="customerId" defaultValue={project?.customerId ?? ""}>
              <option value="">None yet</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field name="location" label="Site / location"><input id="location" name="location" defaultValue={project?.location ?? ""} /></Field>
          <Field name="managerId" label="Project manager">
            <select id="managerId" name="managerId" defaultValue={project?.managerId ?? ""}>
              <option value="">Not assigned</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field name="contractValue" label="Contract value (USD)"><input id="contractValue" name="contractValue" type="number" step="0.01" min="0" required defaultValue={project?.contractValue.toString() ?? ""} /></Field>
          <Field name="status" label="Status">
            <select id="status" name="status" defaultValue={project?.status ?? "PLANNING"}>
              {Object.values(ProjectStatus).map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </Field>
          <Field name="progress" label="Site progress %"><input id="progress" name="progress" type="number" min="0" max="100" defaultValue={project?.progress ?? 0} /></Field>
          <Field name="startDate" label="Start date"><input id="startDate" name="startDate" type="date" defaultValue={toDateInput(project?.startDate)} /></Field>
          <Field name="expectedEnd" label="Planned finish"><input id="expectedEnd" name="expectedEnd" type="date" defaultValue={toDateInput(project?.expectedEnd)} /></Field>
          <Field name="actualEnd" label="Actual finish"><input id="actualEnd" name="actualEnd" type="date" defaultValue={toDateInput(project?.actualEnd)} /></Field>
        </div>
      </div>
      <div className="panel">
        <h2>Budget by category</h2>
        <p className="hint" style={{ margin: 0 }}>Leave a category blank if it has no budget. Alerts fire at 80%, 90% and 100% of each line.</p>
        <div className="fields three">
          {MANUAL_CATEGORIES.map((c) => (
            <Field key={c} name={`budget_${c}`} label={CATEGORY_LABEL[c]}>
              <input id={`budget_${c}`} name={`budget_${c}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={b.get(c) ?? ""} />
            </Field>
          ))}
        </div>
        <label className="row small"><input type="checkbox" name="confirmLoss" /> The budget is higher than the contract value and that is intended</label>
      </div>
      <div className="row"><Submit>{project ? "Save project" : "Create project"}</Submit></div>
    </ActionForm>
  );
}
