import type { Role } from "@/generated/prisma/client";

export type Module =
  | "dashboard" | "projects" | "customers" | "suppliers" | "invoices"
  | "expenses" | "finance" | "reports" | "settings" | "attendance" | "payroll" | "assets" | "usage" | "stock" | "purchasing" | "subcontracts" | "operations";

const ALL: Module[] = ["dashboard", "projects", "customers", "suppliers", "invoices", "expenses", "finance", "reports", "settings", "attendance", "payroll", "assets", "usage", "stock", "purchasing", "subcontracts", "operations"];

// What each role may open. "write" below says who may change records in that module.
export const READ: Record<Role, Module[]> = {
  SUPER_ADMIN: ALL,
  FINANCE_MANAGER: ["dashboard", "projects", "customers", "suppliers", "invoices", "expenses", "finance", "reports", "attendance", "payroll", "assets", "usage", "stock", "purchasing", "subcontracts", "operations"],
  ACCOUNTANT: ["dashboard", "projects", "customers", "suppliers", "invoices", "expenses", "finance", "reports", "attendance", "payroll", "assets", "usage", "stock", "purchasing", "subcontracts", "operations"],
  PROJECT_MANAGER: ["dashboard", "projects", "customers", "suppliers", "expenses", "reports", "attendance", "assets", "usage", "stock", "purchasing", "subcontracts", "operations"],
  SITE_SUPERVISOR: ["dashboard", "projects", "expenses", "attendance", "assets", "usage", "stock", "operations"],
  HR: ["dashboard", "projects", "attendance", "payroll"],
  STOREKEEPER: ["dashboard", "projects", "suppliers", "expenses", "assets", "usage", "stock", "purchasing", "operations"],
  VIEWER: ["dashboard", "projects", "customers", "suppliers", "invoices", "expenses", "finance", "reports", "assets", "stock", "purchasing", "subcontracts", "operations"],
};

export const WRITE: Record<Role, Module[]> = {
  SUPER_ADMIN: ALL,
  FINANCE_MANAGER: ["projects", "customers", "suppliers", "invoices", "expenses", "finance", "attendance", "payroll", "assets", "usage", "stock", "purchasing", "subcontracts"],
  ACCOUNTANT: ["customers", "suppliers", "invoices", "expenses", "finance", "payroll", "subcontracts"],
  PROJECT_MANAGER: ["projects", "expenses", "attendance", "assets", "usage", "stock", "purchasing", "subcontracts", "operations"],
  SITE_SUPERVISOR: ["expenses", "attendance", "usage", "stock", "operations"],
  HR: ["attendance", "payroll"],
  STOREKEEPER: ["expenses", "usage", "stock", "purchasing"],
  VIEWER: [],
};

// Who may approve an expense, mark it paid, or void financial records.
export const APPROVERS: Role[] = ["SUPER_ADMIN", "FINANCE_MANAGER", "ACCOUNTANT"];
export const canRead = (r: Role, m: Module) => READ[r].includes(m);
export const canWrite = (r: Role, m: Module) => WRITE[r].includes(m);

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  FINANCE_MANAGER: "Finance Manager",
  PROJECT_MANAGER: "Project Manager",
  SITE_SUPERVISOR: "Site Supervisor",
  ACCOUNTANT: "Accountant",
  HR: "HR",
  STOREKEEPER: "Storekeeper",
  VIEWER: "Viewer",
};
