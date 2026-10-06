import type { Module } from "@/lib/permissions";

// What may be deleted, and when. The rule is the same everywhere: a record can be deleted only if nothing else
// depends on it and it never touched the books. Anything already posted to the ledger is voided instead, which
// reverses it and keeps it on record.

export const KINDS = {
  customer: { module: "customers", noun: "customer", model: "Customer" },
  supplier: { module: "suppliers", noun: "supplier", model: "Supplier" },
  project: { module: "projects", noun: "project", model: "Project" },
  invoice: { module: "invoices", noun: "invoice", model: "Invoice" },
  expense: { module: "expenses", noun: "expense", model: "Expense" },
  employee: { module: "payroll", noun: "employee", model: "Employee" },
  material: { module: "stock", noun: "material", model: "Material" },
  asset: { module: "assets", noun: "asset", model: "Asset" },
  task: { module: "operations", noun: "task", model: "Task" },
  subcontract: { module: "subcontracts", noun: "subcontract", model: "Subcontract" },
} as const satisfies Record<string, { module: Module; noun: string; model: string }>;

export type Kind = keyof typeof KINDS;
export const isKind = (k: string): k is Kind => Object.hasOwn(KINDS, k);

const WORDS: Record<string, [string, string]> = {
  projects: ["project", "projects"], invoices: ["invoice", "invoices"], expenses: ["expense", "expenses"], rentals: ["equipment hire", "equipment hires"],
  purchaseOrders: ["purchase order", "purchase orders"], subcontracts: ["subcontract", "subcontracts"], lines: ["ledger entry", "ledger entries"],
  attendance: ["attendance record", "attendance records"], payAllocations: ["payroll allocation", "payroll allocations"], assetAssignments: ["equipment assignment", "equipment assignments"],
  assetUsages: ["equipment usage entry", "equipment usage entries"], stockMovements: ["stock movement", "stock movements"], tasks: ["task", "tasks"],
  siteReports: ["site report", "site reports"], siteIssues: ["site issue", "site issues"], payrollLines: ["payslip", "payslips"], advances: ["advance", "advances"],
  movements: ["stock movement", "stock movements"], poLines: ["purchase order line", "purchase order lines"], receipts: ["goods receipt line", "goods receipt lines"],
  assignments: ["assignment", "assignments"], usage: ["usage entry", "usage entries"], maintenance: ["maintenance record", "maintenance records"],
  updates: ["progress update", "progress updates"], issues: ["site issue", "site issues"], variations: ["variation", "variations"],
  certificates: ["payment certificate", "payment certificates"], releases: ["retention release", "retention releases"], payments: ["payment", "payments"], journal: ["ledger entry", "ledger entries"],
};

/** "it is still used by 2 projects and 1 invoice", or null when nothing depends on it. */
export function dependents(counts: Record<string, number>): string | null {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${(WORDS[k] ?? [k, k])[n === 1 ? 0 : 1]}`);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `it is still used by ${list}`;
}
