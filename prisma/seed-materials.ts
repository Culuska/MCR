import "dotenv/config";
import { db } from "../src/lib/db";
import { postEntry } from "../src/lib/ledger";
import { nextNumber } from "../src/lib/sequence";
import { SYS } from "../src/lib/domain";
import { D, round2 } from "../src/lib/money";
import { afterIssue, afterReceipt, valueAt } from "../src/lib/stock";

// Phase 4 seed. Only runs when there are no materials yet. Everything is marked "(sample)".

const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };

const MATERIALS: [string, string, string, number][] = [
  ["Portland cement 50kg (sample)", "Cement", "bag", 200],
  ["Sharp sand (sample)", "Sand and gravel", "tonne", 20],
  ["Gravel 20mm (sample)", "Sand and gravel", "tonne", 20],
  ["Concrete block 6in (sample)", "Blocks and bricks", "piece", 2000],
  ["Rebar 12mm (sample)", "Steel and rebar", "tonne", 3],
  ["PVC pipe 110mm, 6m (sample)", "Pipes and fittings", "piece", 30],
];

async function main() {
  if ((await db.material.count()) > 0) { console.log("Materials already exist. Sample stock skipped."); return; }
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const store = await db.user.findFirstOrThrow({ where: { role: "STOREKEEPER" } });
  const p1 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-01" } });
  const p2 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-02" } });
  const cementCo = await db.supplier.findFirstOrThrow({ where: { name: { contains: "Cement" } } });
  const steelCo = await db.supplier.findFirstOrThrow({ where: { name: { contains: "Steel" } } });
  const bank = await db.account.findUniqueOrThrow({ where: { code: "1010" } });
  const grniAccount = await db.account.findUniqueOrThrow({ where: { code: SYS.GRNI } });

  const mat: Record<string, string> = {};
  for (const [name, category, unit, reorder] of MATERIALS) {
    const code = await db.$transaction((tx) => nextNumber(tx, "MAT"));
    mat[name.split(" (")[0]] = (await db.material.create({ data: { code, name, category, unit, reorderLevel: reorder } })).id;
  }
  const id = (n: string) => mat[n];

  // Moves stock and keeps the average cost, the same way the app does.
  async function move(o: { material: string; type: "OPENING" | "RECEIPT" | "ISSUE"; qty: number; unitCost?: number; date: Date; project?: string; receiptId?: string; reference?: string }) {
    await db.$transaction(async (tx) => {
      const m = await tx.material.findUniqueOrThrow({ where: { id: id(o.material) } });
      if (o.type === "ISSUE") {
        const value = valueAt(o.qty, m.avgCost);
        const mv = await tx.stockMovement.create({ data: { materialId: m.id, date: o.date, type: "ISSUE", quantity: D(-o.qty), unitCost: m.avgCost, value, projectId: o.project, createdById: store.id, note: "Sample issue" } });
        await tx.material.update({ where: { id: m.id }, data: afterIssue(m, o.qty) });
        await postEntry(tx, { date: o.date, description: `${o.qty} ${m.unit} of ${m.name} used`, sourceType: "STOCK", sourceId: mv.id, createdById: store.id,
          lines: [{ accountCode: SYS.MATERIALS_EXPENSE, projectId: o.project, debit: value }, { accountCode: SYS.INVENTORY, credit: value }] });
        return;
      }
      const value = round2(D(o.qty).times(o.unitCost!));
      const mv = await tx.stockMovement.create({ data: { materialId: m.id, date: o.date, type: o.type, quantity: D(o.qty), unitCost: D(o.unitCost!), value, receiptId: o.receiptId, reference: o.reference, note: o.type === "OPENING" ? "Opening stock" : null, createdById: admin.id } });
      await tx.material.update({ where: { id: m.id }, data: afterReceipt(m, o.qty, o.unitCost!) });
      if (o.type === "OPENING") {
        await postEntry(tx, { date: o.date, description: `Opening stock: ${o.qty} ${m.unit} of ${m.name}`, sourceType: "STOCK", sourceId: mv.id, createdById: admin.id,
          lines: [{ accountCode: SYS.INVENTORY, debit: value }, { accountCode: SYS.EQUITY, credit: value }] });
      }
    });
  }

  // Orders: lines are [material, quantity, price]. `got` is how much arrived and `bill` whether finance has approved and paid it.
  async function order(o: { supplier: string; ordered: number; expected: number; status: "ORDERED" | "PART_RECEIVED" | "RECEIVED"; lines: [string, number, number, number][]; invoice?: string; arrived?: number; bill?: "paid" | "draft" }) {
    const po = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, "PO");
      return tx.purchaseOrder.create({ data: {
        number, supplierId: o.supplier, orderDate: day(o.ordered), expectedDate: day(o.expected), status: o.status, createdById: admin.id,
        lines: { create: o.lines.map(([name, quantity, unitPrice, received]) => ({ materialId: id(name), quantity, unitPrice, received })) },
      } });
    });
    if (!o.invoice) return;
    const grnNumber = await db.$transaction((tx) => nextNumber(tx, "GRN"));
    const received = o.lines.filter((l) => l[3] > 0);
    const total = received.reduce((a, l) => a + Math.round(l[3] * l[2] * 100) / 100, 0);
    const expense = await db.$transaction(async (tx) => {
      const expNo = await nextNumber(tx, "EXP");
      const when = day(o.arrived!);
      const e = await tx.expense.create({ data: {
        number: expNo, date: when, category: "STOCK_PURCHASE", supplierId: o.supplier, accountId: grniAccount.id, amount: D(total),
        description: `Stock received ${grnNumber} on ${po.number}, supplier invoice ${o.invoice}`, notes: `Supplier invoice no. ${o.invoice}`, createdById: store.id,
        status: o.bill === "paid" ? "PAID" : "DRAFT", approvedById: o.bill === "paid" ? admin.id : null, approvedAt: o.bill === "paid" ? when : null, paidAt: o.bill === "paid" ? when : null, paymentMethod: o.bill === "paid" ? "BANK_TRANSFER" : null,
      } });
      if (o.bill === "paid") {
        await postEntry(tx, { date: when, description: `${expNo} ${o.invoice}`, reference: expNo, sourceType: "EXPENSE", sourceId: e.id, createdById: admin.id,
          lines: [{ accountCode: SYS.GRNI, debit: total }, { accountCode: SYS.AP, credit: total }] });
        const pn = await nextNumber(tx, "PAY");
        const pay = await tx.payment.create({ data: { number: pn, kind: "DISBURSEMENT", date: when, amount: D(total), method: "BANK_TRANSFER", accountId: bank.id, expenseId: e.id } });
        await postEntry(tx, { date: when, description: `${pn} payment for ${expNo}`, reference: expNo, sourceType: "PAYMENT", sourceId: pay.id, createdById: admin.id,
          lines: [{ accountCode: SYS.AP, debit: total }, { accountId: bank.id, credit: total }] });
      }
      return e;
    });
    const grn = await db.goodsReceipt.create({ data: { number: grnNumber, orderId: po.id, receivedDate: day(o.arrived!), invoiceNumber: o.invoice, expenseId: expense.id, createdById: store.id,
      lines: { create: received.map(([name, , price, got]) => ({ materialId: id(name), quantity: got, unitPrice: price })) } } });
    for (const [name, , price, got] of received) await move({ material: name, type: "RECEIPT", qty: got, unitCost: price, date: day(o.arrived!), receiptId: grn.id, reference: `${grnNumber} / ${po.number}` });
    // Stock is in Inventory the day it arrives, owed for but not yet invoiced.
    await db.$transaction((tx) => postEntry(tx, { date: day(o.arrived!), description: `Goods received ${grnNumber} on ${po.number}`, reference: grnNumber, sourceType: "STOCK", sourceId: grn.id, createdById: store.id,
      lines: [{ accountCode: SYS.INVENTORY, debit: total }, { accountCode: SYS.GRNI, credit: total }] }));
  }

  await move({ material: "Portland cement 50kg", type: "OPENING", qty: 300, unitCost: 8.2, date: day(-60) });
  await move({ material: "Concrete block 6in", type: "OPENING", qty: 3000, unitCost: 0.55, date: day(-60) });

  await order({ supplier: cementCo.id, ordered: -30, expected: -25, status: "RECEIVED", invoice: "CEM-4471", arrived: -25, bill: "paid",
    lines: [["Portland cement 50kg", 500, 8.5, 500], ["Sharp sand", 60, 14, 60], ["Gravel 20mm", 80, 18, 80]] });
  await order({ supplier: steelCo.id, ordered: -12, expected: -6, status: "PART_RECEIVED", invoice: "ST-882", arrived: -8, bill: "draft",
    lines: [["Rebar 12mm", 10, 780, 6], ["PVC pipe 110mm, 6m", 60, 11.5, 0]] });
  await order({ supplier: cementCo.id, ordered: -3, expected: 4, status: "ORDERED", lines: [["Concrete block 6in", 4000, 0.58, 0]] });

  // Use on the two sites over the last few weeks. Cement ends up under its reorder level.
  await move({ material: "Portland cement 50kg", type: "ISSUE", qty: 380, date: day(-20), project: p1.id });
  await move({ material: "Portland cement 50kg", type: "ISSUE", qty: 330, date: day(-9), project: p2.id });
  await move({ material: "Sharp sand", type: "ISSUE", qty: 28, date: day(-18), project: p1.id });
  await move({ material: "Sharp sand", type: "ISSUE", qty: 22, date: day(-7), project: p2.id });
  await move({ material: "Gravel 20mm", type: "ISSUE", qty: 40, date: day(-17), project: p2.id });
  await move({ material: "Concrete block 6in", type: "ISSUE", qty: 2500, date: day(-14), project: p1.id });
  await move({ material: "Rebar 12mm", type: "ISSUE", qty: 4, date: day(-5), project: p2.id });

  console.log(`Added ${MATERIALS.length} sample materials, 3 purchase orders, deliveries and issues to both projects.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
