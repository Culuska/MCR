"use server";

import { revalidatePath } from "next/cache";
import { assertProject, assertRecord, scopeOf } from "@/lib/scope";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { postEntry, reverseEntries } from "@/lib/ledger";
import { SYS } from "@/lib/domain";
import { D, ZERO, fmt2, fmtDate, round2, sum } from "@/lib/money";
import { APPROVERS } from "@/lib/permissions";
import { afterAdjustment, afterIssue, afterReceipt, afterReversedReceipt, valueAt } from "@/lib/stock";
import { date, formObject, optionalDate, optionalText, run, type FormState } from "@/lib/action";

const refresh = () => revalidatePath("/", "layout");
const endOfToday = () => { const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d; };
const ADJUSTMENT_LIMIT = 500; // larger write-offs need finance

// Two people moving the same material at once must not both read the old balance.
async function lockMaterial(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${id} FOR UPDATE`;
  return tx.material.findUniqueOrThrow({ where: { id } });
}

async function openProject(tx: Tx, projectId: string) {
  const p = await tx.project.findUnique({ where: { id: projectId } });
  if (!p) throw new ActionError("That project does not exist.");
  if (p.status === "CANCELLED" || p.status === "COMPLETED") throw new ActionError(`Project ${p.code} is ${p.status.toLowerCase()}.`);
  return p;
}

/* -------------------------------------- materials ------------------------------------- */

const materialSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the material name."), category: z.string().trim().min(2, "Enter a category."),
  unit: z.string().trim().min(1, "Enter the unit, for example bag or tonne."),
  reorderLevel: z.coerce.number().min(0, "The reorder level cannot be negative.").max(1e9).default(0),
  active: z.enum(["on", "off"]).default("on"),
});

export async function saveMaterial(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("stock");
    const v = materialSchema.parse(formObject(fd));
    return db.$transaction(async (tx) => {
      const clash = await tx.material.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, id: v.id ? { not: v.id } : undefined } });
      if (clash) throw new ActionError(`${clash.name} is already in the list (${clash.code}).`);
      const data = { name: v.name, category: v.category, unit: v.unit, reorderLevel: D(v.reorderLevel), active: v.active === "on" };
      if (v.id) {
        await tx.material.update({ where: { id: v.id }, data });
        await audit({ userId: user.id, action: "material.update", entity: "Material", entityId: v.id, summary: `${user.name} updated ${v.name}` }, tx);
        refresh();
        return `${v.name} saved`;
      }
      const code = await nextNumber(tx, "MAT");
      const m = await tx.material.create({ data: { ...data, code } });
      await audit({ userId: user.id, action: "material.create", entity: "Material", entityId: m.id, summary: `${user.name} added ${m.name} (${m.code}), counted in ${m.unit}` }, tx);
      refresh();
      return `${m.name} added as ${m.code}`;
    });
  });
}

const openingSchema = z.object({ materialId: z.string().min(1, "Choose the material."), quantity: z.coerce.number().positive("Enter the quantity."), unitCost: z.coerce.number().positive("Enter the cost per unit."), date });

// Stock already on the shelf when the system starts: Inventory up, owner's equity up.
export async function openingStock(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("stock");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can enter opening stock.");
    const v = openingSchema.parse(formObject(fd));
    if (v.date > endOfToday()) throw new ActionError("The date cannot be in the future.");
    return db.$transaction(async (tx) => {
      const m = await lockMaterial(tx, v.materialId);
      const next = afterReceipt(m, v.quantity, v.unitCost);
      const value = round2(D(v.quantity).times(v.unitCost));
      const mv = await tx.stockMovement.create({ data: { materialId: m.id, date: v.date, type: "OPENING", quantity: D(v.quantity), unitCost: D(v.unitCost), value, note: "Opening stock", createdById: user.id } });
      await tx.material.update({ where: { id: m.id }, data: next });
      await postEntry(tx, { date: v.date, description: `Opening stock: ${v.quantity} ${m.unit} of ${m.name}`, sourceType: "STOCK", sourceId: mv.id, createdById: user.id,
        lines: [{ accountCode: SYS.INVENTORY, debit: value, memo: m.name }, { accountCode: SYS.EQUITY, credit: value }] });
      await audit({ userId: user.id, action: "stock.opening", entity: "Material", entityId: m.id, summary: `${user.name} entered opening stock of ${v.quantity} ${m.unit} ${m.name} worth ${fmt2(value)}` }, tx);
      refresh();
      return `${v.quantity} ${m.unit} of ${m.name} added, worth ${fmt2(value)}`;
    });
  });
}

/* ----------------------------------- purchase orders ---------------------------------- */

const LINES = 6;
const orderSchema = z.object({ supplierId: z.string().min(1, "Choose the supplier."), projectId: optionalText, orderDate: date, expectedDate: optionalDate, notes: optionalText });

export async function createPurchaseOrder(_: FormState, fd: FormData): Promise<FormState> {
  let newId: string | null = null;
  const result = await run(async () => {
    const user = await requireWrite("purchasing");
    const raw = formObject(fd);
    const v = orderSchema.parse(raw);
    if (!(await scopeOf(user)).all && !v.projectId) throw new ActionError("Choose the project this is for."); if (v.projectId) await assertProject(user, v.projectId);
    if (v.expectedDate && v.expectedDate < v.orderDate) throw new ActionError("The expected delivery cannot be before the order date.");

    const lines: { materialId: string; quantity: number; unitPrice: number }[] = [];
    for (let i = 0; i < LINES; i++) {
      const materialId = String(raw[`m_${i}`] ?? ""), qty = String(raw[`q_${i}`] ?? ""), price = String(raw[`p_${i}`] ?? "");
      if (!materialId && !qty && !price) continue;
      if (!materialId) throw new ActionError(`Line ${i + 1}: choose the material.`);
      const quantity = Number(qty), unitPrice = Number(price);
      if (!(quantity > 0)) throw new ActionError(`Line ${i + 1}: enter a quantity above zero.`);
      if (!(unitPrice > 0)) throw new ActionError(`Line ${i + 1}: enter the price per unit.`);
      if (lines.some((l) => l.materialId === materialId)) throw new ActionError(`Line ${i + 1}: that material is already on this order. Add the quantities together.`);
      lines.push({ materialId, quantity, unitPrice });
    }
    if (!lines.length) throw new ActionError("Add at least one material to the order.");

    return db.$transaction(async (tx) => {
      if (v.projectId) await openProject(tx, v.projectId);
      const number = await nextNumber(tx, "PO");
      const po = await tx.purchaseOrder.create({
        data: { number, supplierId: v.supplierId, projectId: v.projectId ?? null, orderDate: v.orderDate, expectedDate: v.expectedDate ?? null, notes: v.notes ?? null, createdById: user.id,
          lines: { create: lines.map((l) => ({ materialId: l.materialId, quantity: D(l.quantity), unitPrice: D(l.unitPrice) })) } },
      });
      const total = sum(lines.map((l) => round2(D(l.quantity).times(l.unitPrice))));
      await audit({ userId: user.id, action: "po.create", entity: "PurchaseOrder", entityId: po.id, summary: `${user.name} created ${number}, ${lines.length} line${lines.length === 1 ? "" : "s"}, ${fmt2(total)}` }, tx);
      newId = po.id;
      refresh();
      return `${number} created for ${fmt2(total)}`;
    });
  });
  if (newId && result?.ok) return { ok: `${result.ok}|${newId}` };
  return result;
}

export async function transitionOrder(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("purchasing");
    const { id, to } = z.object({ id: z.string(), to: z.enum(["ORDER", "CANCEL"]) }).parse(formObject(fd));
    await assertRecord(user, "purchaseOrder", id);
    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { receipts: { where: { reversed: false } } } });
      if (to === "ORDER") {
        if (po.status !== "DRAFT") throw new ActionError(`${po.number} is already ${po.status.toLowerCase().replace("_", " ")}.`);
        await tx.purchaseOrder.update({ where: { id }, data: { status: "ORDERED" } });
        await audit({ userId: user.id, action: "po.order", entity: "PurchaseOrder", entityId: id, summary: `${user.name} sent ${po.number} to the supplier` }, tx);
        refresh();
        return `${po.number} marked as ordered`;
      }
      if (po.status === "CANCELLED") throw new ActionError(`${po.number} is already cancelled.`);
      if (po.status === "RECEIVED" || po.receipts.length) throw new ActionError(`Goods have been received on ${po.number}. Reverse the receipt first.`);
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await audit({ userId: user.id, action: "po.cancel", entity: "PurchaseOrder", entityId: id, summary: `${user.name} cancelled ${po.number}` }, tx);
      refresh();
      return `${po.number} cancelled`;
    });
  });
}

/* --------------------------------------- receiving ------------------------------------- */

const receiveSchema = z.object({ orderId: z.string(), receivedDate: date, invoiceNumber: z.string().trim().min(1, "Enter the supplier's invoice number.") });

export async function receiveGoods(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("purchasing");
    const raw = formObject(fd);
    const v = receiveSchema.parse(raw);
    await assertRecord(user, "purchaseOrder", v.orderId);
    if (v.receivedDate > endOfToday()) throw new ActionError("The delivery date cannot be in the future.");

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: v.orderId }, include: { lines: { include: { material: true } }, supplier: true } });
      if (po.status !== "ORDERED" && po.status !== "PART_RECEIVED") throw new ActionError(`${po.number} is ${po.status.toLowerCase().replace("_", " ")}. Mark it as ordered before receiving goods.`);

      // The same supplier invoice cannot be booked twice.
      const dup = await tx.goodsReceipt.findFirst({ where: { reversed: false, invoiceNumber: { equals: v.invoiceNumber, mode: "insensitive" }, order: { supplierId: po.supplierId } } });
      if (dup) throw new ActionError(`Invoice ${v.invoiceNumber} from ${po.supplier.name} is already recorded on ${dup.number}.`);

      const received: { line: (typeof po.lines)[number]; qty: number }[] = [];
      for (const line of po.lines) {
        const text = String(raw[`r_${line.id}`] ?? "").trim();
        if (!text) continue;
        const qty = Number(text);
        if (!(qty > 0)) throw new ActionError(`${line.material.name}: enter a quantity above zero, or leave it blank.`);
        const outstanding = D(line.quantity).minus(line.received);
        if (D(qty).greaterThan(outstanding)) throw new ActionError(`${line.material.name}: only ${outstanding} ${line.material.unit} is still due on this order.`);
        received.push({ line, qty });
      }
      if (!received.length) throw new ActionError("Enter the quantity received for at least one line.");

      const number = await nextNumber(tx, "GRN");
      const grn = await tx.goodsReceipt.create({ data: { number, orderId: po.id, receivedDate: v.receivedDate, invoiceNumber: v.invoiceNumber, createdById: user.id } });
      let total = ZERO;
      for (const { line, qty } of received) {
        const m = await lockMaterial(tx, line.materialId);
        const value = round2(D(qty).times(line.unitPrice));
        total = total.plus(value);
        await tx.receiptLine.create({ data: { receiptId: grn.id, materialId: m.id, quantity: D(qty), unitPrice: line.unitPrice } });
        await tx.stockMovement.create({ data: { materialId: m.id, date: v.receivedDate, type: "RECEIPT", quantity: D(qty), unitCost: line.unitPrice, value, receiptId: grn.id, reference: `${number} / ${po.number}`, createdById: user.id } });
        await tx.material.update({ where: { id: m.id }, data: afterReceipt(m, qty, line.unitPrice) });
        await tx.poLine.update({ where: { id: line.id }, data: { received: { increment: D(qty) } } });
      }
      const after = await tx.poLine.findMany({ where: { orderId: po.id } });
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: after.every((l) => !D(l.received).lessThan(l.quantity)) ? "RECEIVED" : "PART_RECEIVED" } });

      // Stock is an asset the moment it arrives, owed for but not yet invoiced. Approving the bill later moves that debt to payables.
      await postEntry(tx, { date: v.receivedDate, description: `Goods received ${number} on ${po.number}`, reference: number, sourceType: "STOCK", sourceId: grn.id, createdById: user.id,
        lines: [{ accountCode: SYS.INVENTORY, debit: total }, { accountCode: SYS.GRNI, credit: total, memo: po.supplier.name }] });
      const account = await tx.account.findUniqueOrThrow({ where: { code: SYS.GRNI } });
      const expense = await tx.expense.create({ data: {
        number: await nextNumber(tx, "EXP"), date: v.receivedDate, category: "STOCK_PURCHASE", supplierId: po.supplierId, accountId: account.id, amount: total,
        description: `Stock received ${number} on ${po.number}, supplier invoice ${v.invoiceNumber}`, notes: `Supplier invoice no. ${v.invoiceNumber}`, createdById: user.id,
      } });
      await tx.goodsReceipt.update({ where: { id: grn.id }, data: { expenseId: expense.id } });
      await audit({ userId: user.id, action: "stock.receive", entity: "PurchaseOrder", entityId: po.id, summary: `${user.name} received ${received.length} line${received.length === 1 ? "" : "s"} on ${po.number} (${number}, invoice ${v.invoiceNumber}) worth ${fmt2(total)}` }, tx);
      refresh();
      return `${number} recorded. Draft bill ${expense.number} for ${fmt2(total)} is waiting for approval.`;
    });
  });
}

// Takes a delivery back out: stock down, the bill voided. Refused if any of it has been used.
export async function reverseReceipt(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("purchasing");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can reverse a goods receipt.");
    const { id, reason } = z.object({ id: z.string(), reason: z.string().trim().min(3, "Give a reason for reversing this receipt.") }).parse(formObject(fd));
    await assertRecord(user, "goodsReceipt", id);
    return db.$transaction(async (tx) => {
      const g = await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { lines: { include: { material: true } }, order: { include: { lines: true } }, expense: { include: { payments: { where: { voided: false } } } } } });
      if (g.reversed) throw new ActionError(`${g.number} is already reversed.`);
      if (g.expense?.payments.length) throw new ActionError(`The bill ${g.expense.number} has been paid. Void that payment first.`);

      for (const l of g.lines) {
        const m = await lockMaterial(tx, l.materialId);
        try { await tx.material.update({ where: { id: m.id }, data: afterReversedReceipt(m, l.quantity, l.unitPrice) }); }
        catch { throw new ActionError(`Some of the ${m.name} from this delivery has already been used, so it cannot be reversed. Use a stock adjustment instead.`); }
        await tx.poLine.updateMany({ where: { orderId: g.orderId, materialId: l.materialId }, data: { received: { decrement: l.quantity } } });
      }
      await tx.stockMovement.updateMany({ where: { receiptId: id }, data: { voided: true } });
      await reverseEntries(tx, "STOCK", g.id, user.id, reason); // takes the stock and the accrual back out of the ledger
      if (g.expense && g.expense.status !== "VOID") {
        if (g.expense.status === "APPROVED" || g.expense.status === "PAID") await reverseEntries(tx, "EXPENSE", g.expense.id, user.id, reason);
        await tx.expense.update({ where: { id: g.expense.id }, data: { status: "VOID", notes: `Voided: goods receipt ${g.number} reversed. ${reason}` } });
      }
      await tx.goodsReceipt.update({ where: { id }, data: { reversed: true } });
      const lines = await tx.poLine.findMany({ where: { orderId: g.orderId } });
      await tx.purchaseOrder.update({ where: { id: g.orderId }, data: { status: lines.every((x) => D(x.received).isZero()) ? "ORDERED" : "PART_RECEIVED" } });
      await audit({ userId: user.id, action: "stock.receive.reverse", entity: "PurchaseOrder", entityId: g.orderId, summary: `${user.name} reversed ${g.number}: ${reason}` }, tx);
      refresh();
      return `${g.number} reversed`;
    });
  });
}

/* ------------------------------- issuing and corrections ------------------------------ */

const issueSchema = z.object({
  materialId: z.string().min(1, "Choose the material."), projectId: z.string().min(1, "Choose the project it is for."),
  quantity: z.coerce.number({ error: "Enter the quantity." }).positive("The quantity must be more than zero."), date, note: optionalText,
});

// Using stock on a project is what turns it into a cost: Dr Materials (on the project), Cr Inventory.
export async function issueMaterial(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("stock");
    const v = issueSchema.parse(formObject(fd));
    await assertProject(user, v.projectId);
    if (v.date > endOfToday()) throw new ActionError("The date cannot be in the future.");
    return db.$transaction(async (tx) => {
      const project = await openProject(tx, v.projectId);
      const m = await lockMaterial(tx, v.materialId);
      if (D(v.quantity).greaterThan(m.onHand)) throw new ActionError(`Only ${m.onHand} ${m.unit} of ${m.name} is in stock.`);
      if (D(m.avgCost).isZero()) throw new ActionError(`${m.name} has no cost yet. Receive it against an order or enter opening stock first.`);
      const value = valueAt(v.quantity, m.avgCost);
      const mv = await tx.stockMovement.create({ data: { materialId: m.id, date: v.date, type: "ISSUE", quantity: D(v.quantity).negated(), unitCost: m.avgCost, value, projectId: project.id, note: v.note ?? null, createdById: user.id } });
      await tx.material.update({ where: { id: m.id }, data: afterIssue(m, v.quantity) });
      if (value.greaterThan(0)) {
        await postEntry(tx, { date: v.date, description: `${v.quantity} ${m.unit} of ${m.name} used on ${project.code}`, sourceType: "STOCK", sourceId: mv.id, createdById: user.id,
          lines: [{ accountCode: SYS.MATERIALS_EXPENSE, projectId: project.id, debit: value, memo: m.name }, { accountCode: SYS.INVENTORY, credit: value }] });
      }
      await audit({ userId: user.id, action: "stock.issue", entity: "Material", entityId: m.id, summary: `${user.name} issued ${v.quantity} ${m.unit} of ${m.name} to ${project.code}, cost ${fmt2(value)}` }, tx);
      refresh();
      return `${v.quantity} ${m.unit} issued to ${project.code}, cost ${fmt2(value)}`;
    });
  });
}

export async function voidIssue(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("stock");
    if (!APPROVERS.includes(user.role)) throw new ActionError("Only finance staff can void a stock issue.");
    const { id, reason } = z.object({ id: z.string(), reason: z.string().trim().min(3, "Give a reason for voiding this issue.") }).parse(formObject(fd));
    await assertRecord(user, "stockMovement", id);
    return db.$transaction(async (tx) => {
      const mv = await tx.stockMovement.findUniqueOrThrow({ where: { id }, include: { material: true, project: true } });
      if (mv.type !== "ISSUE") throw new ActionError("Only issues to a project can be voided here.");
      if (mv.voided) throw new ActionError("That issue is already void.");
      const m = await lockMaterial(tx, mv.materialId);
      const qty = D(mv.quantity).abs();
      await reverseEntries(tx, "STOCK", mv.id, user.id, reason);
      await tx.material.update({ where: { id: m.id }, data: afterReceipt(m, qty, mv.unitCost) }); // goes back in at the cost it left at
      await tx.stockMovement.update({ where: { id }, data: { voided: true } });
      await audit({ userId: user.id, action: "stock.issue.void", entity: "Material", entityId: m.id, summary: `${user.name} voided the issue of ${qty} ${m.unit} of ${m.name} to ${mv.project?.code}: ${reason}` }, tx);
      refresh();
      return `Issue voided. ${qty} ${m.unit} is back in stock.`;
    });
  });
}

const adjustSchema = z.object({ materialId: z.string().min(1, "Choose the material."), change: z.coerce.number({ error: "Enter how many to add or remove." }), reason: z.string().trim().min(3, "Say why the count changed."), date });

// A stock count found more or less than the records say: write the difference off or on at average cost.
export async function adjustStock(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("stock");
    const v = adjustSchema.parse(formObject(fd));
    if (v.date > endOfToday()) throw new ActionError("The date cannot be in the future.");
    return db.$transaction(async (tx) => {
      const m = await lockMaterial(tx, v.materialId);
      let next;
      try { next = afterAdjustment(m, v.change); } catch (e) { throw new ActionError(`${m.name}: ${(e as Error).message}`); }
      const value = valueAt(v.change, m.avgCost);
      if (value.greaterThan(ADJUSTMENT_LIMIT) && !APPROVERS.includes(user.role)) throw new ActionError(`An adjustment worth ${fmt2(value)} needs finance staff to enter it. The limit for others is ${fmt2(ADJUSTMENT_LIMIT)}.`);
      const mv = await tx.stockMovement.create({ data: { materialId: m.id, date: v.date, type: "ADJUSTMENT", quantity: D(v.change), unitCost: m.avgCost, value, note: v.reason, createdById: user.id } });
      await tx.material.update({ where: { id: m.id }, data: next });
      if (value.greaterThan(0)) {
        const gain = D(v.change).greaterThan(0);
        await postEntry(tx, { date: v.date, description: `Stock ${gain ? "gain" : "write-off"}: ${v.change} ${m.unit} of ${m.name}. ${v.reason}`, sourceType: "STOCK", sourceId: mv.id, createdById: user.id,
          lines: gain ? [{ accountCode: SYS.INVENTORY, debit: value }, { accountCode: SYS.OTHER_EXPENSE, credit: value, memo: "Stock count gain" }]
                      : [{ accountCode: SYS.OTHER_EXPENSE, debit: value, memo: "Stock write-off" }, { accountCode: SYS.INVENTORY, credit: value }] });
      }
      await audit({ userId: user.id, action: "stock.adjust", entity: "Material", entityId: m.id, summary: `${user.name} adjusted ${m.name} by ${v.change} ${m.unit} (${fmt2(value)}) on ${fmtDate(v.date)}: ${v.reason}` }, tx);
      refresh();
      return `${m.name} adjusted by ${v.change} ${m.unit}, ${fmt2(value)}`;
    });
  });
}

