import "dotenv/config";
import { db } from "../src/lib/db";
import { postEntry } from "../src/lib/ledger";
import { nextNumber } from "../src/lib/sequence";
import { CATEGORY_ACCOUNT, SYS } from "../src/lib/domain";
import { D } from "../src/lib/money";
import { rentalTotal } from "../src/lib/rentals";
import type { AssetKind, ExpenseCategory, Ownership } from "../src/generated/prisma/client";

// Phase 3 seed. Only runs when there are no assets yet. Everything is marked "(sample)".

const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };

type Seed = { name: string; kind: AssetKind; type: string; reg?: string; own: Ownership; price?: number; project: "p1" | "p2" | null; since: number; lPerUnit: number; perDay: number; service?: number; insurance?: number; driver?: string };
const ASSETS: Seed[] = [
  { name: "Excavator 1 (sample)", kind: "EQUIPMENT", type: "Excavator", own: "OWNED", price: 62000, project: "p2", since: -70, lPerUnit: 12, perDay: 7, service: 25, driver: "Operator A" },
  { name: "Wheel Loader (sample)", kind: "EQUIPMENT", type: "Wheel loader", own: "OWNED", price: 48000, project: "p1", since: -100, lPerUnit: 9, perDay: 6, service: 40 },
  { name: "Tipper Truck 1 (sample)", kind: "VEHICLE", type: "Tipper truck", reg: "T-1001", own: "OWNED", price: 38000, project: "p2", since: -70, lPerUnit: 0.35, perDay: 110, service: 12, insurance: 20, driver: "Driver A" },
  { name: "Tipper Truck 2 (sample)", kind: "VEHICLE", type: "Tipper truck", reg: "T-1002", own: "HIRED", project: "p1", since: -25, lPerUnit: 0.35, perDay: 95, driver: "Driver B" },
  { name: "Concrete Mixer (sample)", kind: "EQUIPMENT", type: "Concrete mixer", own: "OWNED", price: 9500, project: "p1", since: -100, lPerUnit: 4, perDay: 5 },
  { name: "Generator 60 kVA (sample)", kind: "EQUIPMENT", type: "Generator", own: "OWNED", price: 14000, project: "p1", since: -100, lPerUnit: 3, perDay: 9, service: 90 },
  { name: "Site Pickup (sample)", kind: "VEHICLE", type: "Pickup", reg: "P-2001", own: "OWNED", price: 24000, project: null, since: 0, lPerUnit: 0.12, perDay: 60, service: 60, insurance: 200 },
  { name: "Water Tanker (sample)", kind: "VEHICLE", type: "Water tanker", reg: "W-3001", own: "OWNED", price: 21000, project: "p2", since: -70, lPerUnit: 0.4, perDay: 45, service: -3 },
  { name: "Compactor (sample)", kind: "EQUIPMENT", type: "Compactor", own: "HIRED", project: null, since: 0, lPerUnit: 3, perDay: 0 },
];

async function main() {
  if ((await db.asset.count()) > 0) { console.log("Assets already exist. Sample equipment skipped."); return; }
  const admin = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
  const p1 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-01" } });
  const p2 = await db.project.findUniqueOrThrow({ where: { code: "MCR-2026-02" } });
  const hire = await db.supplier.findFirstOrThrow({ where: { name: { contains: "Plant Hire" } } });
  const bank = await db.account.findUniqueOrThrow({ where: { code: "1010" } });
  const proj = { p1: p1.id, p2: p2.id };

  // Costs go through the same postings the app uses: Dr cost / Cr payables on approval, Dr payables / Cr bank on payment.
  async function cost(o: { age: number; asset: string; project: string | null; cat: ExpenseCategory; amount: number; desc: string; supplier?: string; paid?: boolean }) {
    return db.$transaction(async (tx) => {
      const number = await nextNumber(tx, "EXP");
      const account = await tx.account.findUniqueOrThrow({ where: { code: CATEGORY_ACCOUNT[o.cat] } });
      const e = await tx.expense.create({ data: {
        number, date: day(-o.age), projectId: o.project, category: o.cat, supplierId: o.supplier ?? null, assetId: o.asset, description: o.desc, amount: D(o.amount),
        accountId: account.id, status: o.paid === false ? "APPROVED" : "PAID", createdById: admin.id, approvedById: admin.id, approvedAt: day(-o.age), paymentMethod: "BANK_TRANSFER",
        paidAt: o.paid === false ? null : day(-o.age),
      } });
      await postEntry(tx, { date: e.date, description: `${number} ${o.desc}`, reference: number, sourceType: "EXPENSE", sourceId: e.id, createdById: admin.id,
        lines: [{ accountId: account.id, projectId: o.project, debit: o.amount }, { accountCode: SYS.AP, projectId: o.project, credit: o.amount }] });
      if (o.paid !== false) {
        const pn = await nextNumber(tx, "PAY");
        const pay = await tx.payment.create({ data: { number: pn, kind: "DISBURSEMENT", date: e.date, amount: D(o.amount), method: "BANK_TRANSFER", accountId: bank.id, expenseId: e.id } });
        await postEntry(tx, { date: e.date, description: `${pn} payment for ${number}`, reference: number, sourceType: "PAYMENT", sourceId: pay.id, createdById: admin.id,
          lines: [{ accountCode: SYS.AP, projectId: o.project, debit: o.amount }, { accountId: bank.id, projectId: o.project, credit: o.amount }] });
      }
      return e;
    });
  }

  let logged = 0;
  for (const [i, s] of ASSETS.entries()) {
    const code = await db.$transaction((tx) => nextNumber(tx, "AST"));
    const asset = await db.asset.create({ data: {
      code, name: s.name, kind: s.kind, type: s.type, registration: s.reg ?? null, ownership: s.own, purchasePrice: s.price ?? null, fuelType: "Diesel", driver: s.driver ?? null,
      nextServiceDate: s.service === undefined ? null : day(s.service), insuranceExpiry: s.insurance === undefined ? null : day(s.insurance),
    } });
    const projectId = s.project ? proj[s.project] : null;
    if (projectId) await db.assetAssignment.create({ data: { assetId: asset.id, projectId, startDate: day(s.since), createdById: admin.id } });

    // Thirty days of work, skipping Fridays. Readings climb steadily, as a real meter would.
    if (s.perDay > 0) {
      let reading = s.kind === "VEHICLE" ? 41000 + i * 3000 : 800 + i * 400;
      const litresTotal: number[] = [];
      for (let back = 30; back >= 1; back--) {
        const d = day(-back);
        if (d.getUTCDay() === 5 || (s.own === "HIRED" && s.type === "Tipper truck" && back > 25)) continue;
        const units = Math.round((s.perDay * (0.8 + ((back * 7 + i * 3) % 5) / 10)) * 10) / 10;
        const litres = Math.round(units * s.lPerUnit * 10) / 10;
        await db.assetUsage.create({ data: {
          assetId: asset.id, date: d, projectId, operator: s.driver ?? null, startReading: D(reading), endReading: D(reading + units), units: D(units),
          trips: s.kind === "VEHICLE" && s.type === "Tipper truck" ? 6 + (back % 4) : 0, fuelLitres: D(litres), purpose: projectId === p1.id ? "Clinic works" : projectId === p2.id ? "Road and drainage works" : "General", recordedById: admin.id,
        } });
        reading += units; logged++; litresTotal.push(litres);
      }
      // Fuel bought for the month, at about $1.15 a litre, in two purchases.
      const litres = litresTotal.reduce((a, b) => a + b, 0);
      if (litres > 0) {
        await cost({ age: 18, asset: asset.id, project: projectId, cat: "FUEL", amount: Math.round(litres * 0.5 * 1.15), desc: `Diesel for ${s.name.replace(" (sample)", "")}` });
        await cost({ age: 4, asset: asset.id, project: projectId, cat: "FUEL", amount: Math.round(litres * 0.5 * 1.15), desc: `Diesel for ${s.name.replace(" (sample)", "")}` });
      }
    }
    if (s.type === "Excavator") {
      const e = await cost({ age: 40, asset: asset.id, project: null, cat: "EQUIPMENT_MAINTENANCE", amount: 380, desc: "Service: oil, filters and hydraulic check (Excavator 1)" });
      await db.maintenanceRecord.create({ data: { assetId: asset.id, date: day(-40), kind: "SERVICE", description: "500-hour service: oil, filters and hydraulic check", cost: 380, nextServiceDate: day(25), expenseId: e.id, createdById: admin.id } });
    }
    if (s.type === "Water tanker") {
      const e = await cost({ age: 55, asset: asset.id, project: p2.id, cat: "VEHICLE_MAINTENANCE", amount: 210, desc: "Repair: pump seal replaced (Water Tanker)" });
      await db.maintenanceRecord.create({ data: { assetId: asset.id, date: day(-55), kind: "REPAIR", description: "Pump seal replaced", cost: 210, expenseId: e.id, createdById: admin.id } });
    }

    // Hired in: one hire still running and due to end within the week, one finished and fully paid.
    if (s.type === "Tipper truck" && s.own === "HIRED") {
      const start = day(-25), end = day(5), t = rentalTotal("DAILY", 60, start, end, 0);
      await db.$transaction(async (tx) => {
        await tx.rental.create({ data: { number: await nextNumber(tx, "RNT"), assetId: asset.id, supplierId: hire.id, projectId: p1.id, startDate: start, endDate: end, rateType: "DAILY", rate: 60, deposit: 500, total: t.total, createdById: admin.id } });
      });
    }
    if (s.type === "Compactor") {
      const start = day(-45), end = day(-36), t = rentalTotal("DAILY", 45, start, end, 30);
      const e = await cost({ age: 35, asset: asset.id, project: p2.id, cat: "EQUIPMENT_RENTAL", amount: Number(t.total), desc: "Hire of Compactor (sample)", supplier: hire.id });
      await db.$transaction(async (tx) => {
        await tx.rental.create({ data: { number: await nextNumber(tx, "RNT"), assetId: asset.id, supplierId: hire.id, projectId: p2.id, startDate: start, endDate: end, rateType: "DAILY", rate: 45, extraCharges: 30, total: t.total, status: "ENDED", expenseId: e.id, createdById: admin.id } });
      });
    }
  }
  console.log(`Added ${ASSETS.length} sample assets, ${logged} usage entries, fuel, hire and maintenance costs.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
