import type { ExpenseCategory } from "@/generated/prisma/client";

// Account codes the posting rules depend on.
export const SYS = {
  AR: "1100",
  AP: "2000",
  REVENUE: "4000",
  DEFAULT_CASH: "1000",
  ADVANCES: "1300", // money lent to employees, recovered through payroll
  WAGES_PAYABLE: "2300", // net pay owed to employees once a run is approved
  DEDUCTIONS_PAYABLE: "2310",
  WAGES_EXPENSE: "5010",
  INVENTORY: "1200",
  RETENTION: "2320", // retention withheld from subcontractors, owed to them on release
  SUBCONTRACT_EXPENSE: "5080",
  GRNI: "2200", // goods received, not yet invoiced: a liability from the moment stock arrives
  MATERIALS_EXPENSE: "5020",
  OTHER_EXPENSE: "5900",
  EQUITY: "3000",
} as const;

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  WAGES: "Wages",
  FUEL: "Fuel",
  EQUIPMENT_RENTAL: "Equipment rental",
  TRUCK_RENTAL: "Truck rental",
  EQUIPMENT_MAINTENANCE: "Equipment maintenance",
  VEHICLE_MAINTENANCE: "Vehicle maintenance",
  MATERIALS: "Materials",
  TOOLS: "Tools",
  TRANSPORTATION: "Transportation",
  SITE_ACCOMMODATION: "Site accommodation",
  OFFICE_RENT: "Office rent",
  WAREHOUSE_RENT: "Warehouse rent",
  UTILITIES: "Utilities",
  COMMUNICATION: "Communication",
  SUBCONTRACTORS: "Subcontractors",
  PERMITS: "Permits",
  INSURANCE: "Insurance",
  SITE_MEALS: "Site meals",
  STOCK_PURCHASE: "Stock purchase",
  OTHER: "Other",
};

// Default ledger account for each expense category (chart of accounts code).
export const CATEGORY_ACCOUNT: Record<ExpenseCategory, string> = {
  WAGES: "5010",
  MATERIALS: "5020",
  FUEL: "5030",
  EQUIPMENT_RENTAL: "5040",
  TRUCK_RENTAL: "5050",
  VEHICLE_MAINTENANCE: "5050",
  TRANSPORTATION: "5050",
  EQUIPMENT_MAINTENANCE: "5060",
  OFFICE_RENT: "5070",
  WAREHOUSE_RENT: "5070",
  SUBCONTRACTORS: "5080",
  UTILITIES: "5090",
  COMMUNICATION: "5090",
  INSURANCE: "5100",
  PERMITS: "5110",
  SITE_ACCOMMODATION: "5120",
  SITE_MEALS: "5120",
  TOOLS: "5130",
  STOCK_PURCHASE: "2200", // approving a stock bill clears "goods received, not invoiced" into payables
  OTHER: "5900",
};

export const METHOD_LABEL = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  EVC_PLUS: "EVC Plus",
  EDAHAB: "eDahab",
  SAHAL: "Sahal",
  CHEQUE: "Cheque",
} as const;

export const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "info" | "muted"> = {
  DRAFT: "muted", SUBMITTED: "warn", APPROVED: "info", PAID: "good", VOID: "bad",
  SENT: "info", PARTIAL: "warn", OVERDUE: "bad",
  PLANNING: "muted", ACTIVE: "info", ON_HOLD: "warn", COMPLETED: "good", CANCELLED: "bad",
  PRESENT: "good", HALF_DAY: "warn", ABSENT: "bad", LEAVE: "info",
  AVAILABLE: "good", IN_USE: "info", UNDER_REPAIR: "bad", RETIRED: "muted", ENDED: "muted",
  TODO: "muted", IN_PROGRESS: "info", BLOCKED: "bad", DONE: "good",
  LOW: "muted", MEDIUM: "info", HIGH: "warn", URGENT: "bad", REVIEWED: "good", RESOLVED: "good", OPEN: "warn",
};

export const label = (s: string) => (s === "TODO" ? "To do" : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " "));

// Categories a person can choose when entering an expense or setting a budget. Stock bills are raised by receiving goods.
export const MANUAL_CATEGORIES = (Object.keys(CATEGORY_LABEL) as ExpenseCategory[]).filter((c) => c !== "STOCK_PURCHASE");
