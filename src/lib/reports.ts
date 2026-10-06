import { db } from "@/lib/db";
import { allProjectsSummary, cashFlow, ledgerBalances, payables, receivables, subcontractFigures } from "@/lib/finance";
import { CATEGORY_LABEL } from "@/lib/domain";
import { D } from "@/lib/money";
import { balanceSheet, dateLabel, todayDay } from "@/lib/balance-sheet";
import type { Prisma } from "@/generated/prisma/client";

export type Cell = string | number | null | undefined;
export type Report = { title: string; headers: string[]; rows: Cell[][] };
export type Filters = { from?: Date; to?: Date; projectId?: string; compare?: Date };

export const REPORTS: { key: string; title: string; group: "Financial" | "Project" | "Stock" | "Operations"; note?: string; filters?: ("date" | "project" | "asof")[] }[] = [
  { key: "balance-sheet", title: "Balance sheet", group: "Financial", filters: ["asof"] },
  { key: "trial-balance", title: "Trial balance", group: "Financial" },
  { key: "general-ledger", title: "General ledger", group: "Financial", filters: ["date", "project"] },
  { key: "cash-flow", title: "Cash flow, last 12 months", group: "Financial" },
  { key: "receivables", title: "Accounts receivable", group: "Financial" },
  { key: "payables", title: "Accounts payable", group: "Financial" },
  { key: "expenses", title: "Expense report", group: "Financial", filters: ["date", "project"] },
  { key: "payments", title: "Payment report", group: "Financial", filters: ["date", "project"] },
  { key: "project-profitability", title: "Project profitability", group: "Project" },
  { key: "budget-vs-actual", title: "Budget against actual", group: "Project", filters: ["project"] },
  { key: "subcontracts", title: "Subcontract position", group: "Project" },
  { key: "tasks", title: "Task progress and cost", group: "Operations", filters: ["project"] },
  { key: "site-issues", title: "Issues and delays", group: "Operations", filters: ["date", "project"] },
  { key: "stock-valuation", title: "Stock valuation", group: "Stock" },
  { key: "material-usage", title: "Material usage", group: "Stock", filters: ["date", "project"] },
];

const n4 = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Math.round(Number(v.toString()) * 10000) / 10000); // unit costs keep four decimals
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Math.round(Number(v.toString()) * 100) / 100);
const dateRange = (f: Filters): Prisma.DateTimeFilter | undefined => (f.from || f.to ? { gte: f.from, lte: f.to } : undefined);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export async function buildReport(key: string, f: Filters): Promise<Report | null> {
  switch (key) {
    case "balance-sheet": {
      // "As of" is the end date the page sends; compare is an optional second date shown beside it.
      const asOf = f.to ? new Date(f.to.toISOString().slice(0, 10) + "T00:00:00.000Z") : todayDay();
      const sheet = await balanceSheet(f.compare ? [asOf, f.compare] : [asOf]);
      return { title: "Balance sheet", headers: ["Account", ...sheet.dates.map((d) => `As of ${dateLabel(d)}`)],
        rows: sheet.lines.map((l) => ["  ".repeat(l.indent) + l.label, ...(l.amounts ? l.amounts.map(n) : sheet.dates.map(() => ""))]) };
    }
    case "trial-balance": {
      const rows = (await ledgerBalances()).filter((r) => !r.debit.isZero() || !r.credit.isZero());
      return { title: "Trial balance", headers: ["Code", "Account", "Type", "Debit", "Credit"], rows: rows.map((r) => [r.code, r.name, r.type, n(r.debit), n(r.credit)]) };
    }
    case "general-ledger": {
      const lines = await db.journalLine.findMany({
        where: { projectId: f.projectId || undefined, entry: { date: dateRange(f) } },
        include: { entry: true, account: true, project: true }, orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
      });
      return { title: "General ledger", headers: ["Date", "Entry", "Description", "Account", "Project", "Debit", "Credit"],
        rows: lines.map((l) => [day(l.entry.date), l.entry.number, l.entry.description, `${l.account.code} ${l.account.name}`, l.project?.code, n(l.debit), n(l.credit)]) };
    }
    case "cash-flow": {
      const m = await cashFlow(12);
      return { title: "Cash flow", headers: ["Month", "Opening", "Money in", "Money out", "Closing"], rows: m.map((x) => [x.key, n(x.opening), n(x.in), n(x.out), n(x.closing)]) };
    }
    case "receivables": {
      const r = await receivables();
      return { title: "Accounts receivable", headers: ["Invoice", "Customer", "Project", "Issued", "Due", "Invoice amount", "Paid", "Outstanding", "Overdue"],
        rows: r.map((i) => [i.number, i.customer.name, i.project.code, day(i.issueDate), day(i.dueDate), n(i.amount), n(i.paid), n(i.outstanding), i.overdue ? "Yes" : "No"]) };
    }
    case "payables": {
      const r = (await payables()).filter((x) => x.outstanding.greaterThan(0));
      return { title: "Accounts payable", headers: ["Expense", "Date", "Payee", "Category", "Project", "Amount", "Paid", "Owed"],
        rows: r.map((e) => [e.number, day(e.date), e.supplier?.name ?? e.payee, CATEGORY_LABEL[e.category], e.project?.code ?? "Overhead", n(e.amount), n(e.paid), n(e.outstanding)]) };
    }
    case "expenses": {
      const rows = await db.expense.findMany({
        where: { projectId: f.projectId || undefined, date: dateRange(f) }, include: { project: true, supplier: true, createdBy: true, approvedBy: true }, orderBy: { date: "asc" },
      });
      return { title: "Expense report", headers: ["Number", "Date", "Project", "Category", "Supplier or payee", "Description", "Amount", "Status", "Entered by", "Approved by"],
        rows: rows.map((e) => [e.number, day(e.date), e.project?.code ?? "Overhead", CATEGORY_LABEL[e.category], e.supplier?.name ?? e.payee, e.description, n(e.amount), e.status, e.createdBy.name, e.approvedBy?.name]) };
    }
    case "payments": {
      const rows = await db.payment.findMany({
        where: { date: dateRange(f), OR: f.projectId ? [{ invoice: { projectId: f.projectId } }, { expense: { projectId: f.projectId } }] : undefined },
        include: { account: true, invoice: true, expense: true }, orderBy: { date: "asc" },
      });
      return { title: "Payment report", headers: ["Number", "Date", "Direction", "Against", "Account", "Method", "Reference", "Amount", "Void"],
        rows: rows.map((p) => [p.number, day(p.date), p.kind === "RECEIPT" ? "Received" : "Paid", p.invoice?.number ?? p.expense?.number, p.account.name, p.method, p.reference, n(p.amount), p.voided ? "Yes" : ""]) };
    }
    case "project-profitability": {
      const s = await allProjectsSummary();
      return { title: "Project profitability", headers: ["Code", "Project", "Status", "Contract value", "Invoiced", "Received", "Cost to date", "Profit to date", "Progress %", "Expected final cost", "Expected profit"],
        rows: s.map((c) => [c.project.code, c.project.name, c.project.status, n(c.contract), n(c.invoiced), n(c.received), n(c.cost), n(c.actualProfit), c.project.progress, n(c.expectedFinalCost), n(c.expectedProfit)]) };
    }
    case "budget-vs-actual": {
      const s = (await allProjectsSummary()).filter((c) => !f.projectId || c.project.id === f.projectId);
      return { title: "Budget against actual", headers: ["Project", "Category", "Budget", "Spent", "Remaining", "Used %"],
        rows: s.flatMap((c) => c.lines.map((l) => [c.project.code, CATEGORY_LABEL[l.category], n(l.budget), n(l.spent), n(l.remaining), l.budget.isZero() ? "" : Math.round(l.used)])) };
    }
    case "subcontracts": {
      const s = await subcontractFigures();
      return { title: "Subcontract position", headers: ["Subcontract", "Subcontractor", "Project", "Status", "Original value", "Revised value", "Certified to date", "% complete", "Paid", "Approved unpaid", "Retention held"],
        rows: s.map((x) => [x.sub.number, x.sub.supplier.name, x.sub.project.code, x.sub.status, n(x.sub.contractValue), n(x.revised), n(x.certified), Math.round(x.percent), n(x.paid), n(x.unpaid), n(x.retentionHeld)]) };
    }
    case "tasks": {
      const t = await db.task.findMany({ where: { projectId: f.projectId || undefined }, include: { project: true, assignee: true, expenses: { where: { status: { in: ["APPROVED", "PAID"] } }, select: { amount: true } } }, orderBy: [{ project: { code: "asc" } }, { dueDate: "asc" }] });
      return { title: "Task progress and cost", headers: ["Task", "Project", "Title", "Assigned to", "Priority", "Status", "Progress %", "Due", "Overdue", "Estimated cost", "Actual cost"],
        rows: t.map((x) => [x.number, x.project.code, x.title, x.assignee?.name, x.priority, x.status, x.completion, day(x.dueDate), x.status !== "DONE" && x.status !== "CANCELLED" && x.dueDate < new Date() ? "Yes" : "", n(x.estimatedCost), n(x.expenses.reduce((a, e) => a.plus(D(e.amount)), D(0)))]) };
    }
    case "site-issues": {
      const i = await db.siteIssue.findMany({ where: { projectId: f.projectId || undefined, date: dateRange(f) }, include: { project: true, task: true }, orderBy: { date: "asc" } });
      return { title: "Issues and delays", headers: ["Issue", "Date", "Project", "Kind", "Description", "Task", "Days lost", "Status", "Resolution"],
        rows: i.map((x) => [x.number, day(x.date), x.project.code, x.kind, x.description, x.task?.title, n(x.daysLost), x.resolved ? "Resolved" : "Open", x.resolution]) };
    }
    case "stock-valuation": {
      const m = await db.material.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
      return { title: "Stock valuation", headers: ["Code", "Material", "Category", "Unit", "In stock", "Average cost", "Value", "Reorder at", "Low"],
        rows: m.map((x) => [x.code, x.name, x.category, x.unit, n(x.onHand), n4(x.avgCost), n(D(x.onHand).times(x.avgCost)), n(x.reorderLevel), D(x.reorderLevel).greaterThan(0) && D(x.onHand).lessThanOrEqualTo(x.reorderLevel) ? "Yes" : ""]) };
    }
    case "material-usage": {
      const mv = await db.stockMovement.findMany({
        where: { type: "ISSUE", voided: false, projectId: f.projectId || undefined, date: dateRange(f) }, include: { material: true, project: true }, orderBy: { date: "asc" },
      });
      return { title: "Material usage", headers: ["Date", "Project", "Material", "Unit", "Quantity", "Unit cost", "Cost", "Note"],
        rows: mv.map((x) => [day(x.date), x.project?.code, x.material.name, x.material.unit, Math.abs(n(x.quantity)), n4(x.unitCost), n(x.value), x.note]) };
    }
    default:
      return null;
  }
}

// Spreadsheet programs run text that starts with = + - @ as a formula. Prefix those cells so they stay text.
function cell(v: Cell): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(r: Report): string {
  return "﻿" + [r.headers, ...r.rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
