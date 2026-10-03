import { db } from "@/lib/db";
import type { Module } from "@/lib/permissions";

// Which records can carry attachments, which module's permissions govern them, and how to name them.
// Seeing a file needs read access to that module. Adding or removing one needs write access.

export const ENTITIES = {
  Expense: { module: "expenses" as Module, noun: "expense" },
  Invoice: { module: "invoices" as Module, noun: "invoice" },
  SiteReport: { module: "operations" as Module, noun: "site report" },
  PurchaseOrder: { module: "purchasing" as Module, noun: "purchase order" },
  Subcontract: { module: "subcontracts" as Module, noun: "subcontract" },
} as const;

export type EntityName = keyof typeof ENTITIES;
export const isEntity = (s: string): s is EntityName => s in ENTITIES;

// The record's visible name, or null if it does not exist.
export async function describe(entity: EntityName, id: string): Promise<string | null> {
  switch (entity) {
    case "Expense": return (await db.expense.findUnique({ where: { id }, select: { number: true } }))?.number ?? null;
    case "Invoice": return (await db.invoice.findUnique({ where: { id }, select: { number: true } }))?.number ?? null;
    case "PurchaseOrder": return (await db.purchaseOrder.findUnique({ where: { id }, select: { number: true } }))?.number ?? null;
    case "Subcontract": return (await db.subcontract.findUnique({ where: { id }, select: { number: true } }))?.number ?? null;
    case "SiteReport": {
      const r = await db.siteReport.findUnique({ where: { id }, select: { date: true, project: { select: { code: true } } } });
      return r ? `${r.project.code} report of ${r.date.toISOString().slice(0, 10)}` : null;
    }
  }
}
