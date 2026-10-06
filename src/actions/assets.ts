"use server";

import { revalidatePath } from "next/cache";
import { assertProject, assertRecord, scopeOf } from "@/lib/scope";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequence";
import { CATEGORY_ACCOUNT } from "@/lib/domain";
import { D, fmt2, fmtDate } from "@/lib/money";
import { rentalTotal } from "@/lib/rentals";
import { date, formObject, money, optionalAmount, optionalDate, optionalText, run, type FormState } from "@/lib/action";
import { AssetKind, AssetStatus, MaintenanceKind, Ownership, RentalRate } from "@/generated/prisma/enums";

const refresh = () => revalidatePath("/", "layout");
const endOfToday = () => { const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d; };
const day = (d: Date) => d.toISOString().slice(0, 10);

async function openProject(tx: Tx, projectId: string | null | undefined) {
  if (!projectId) return null;
  const p = await tx.project.findUnique({ where: { id: projectId } });
  if (!p) throw new ActionError("That project does not exist.");
  if (p.status === "CANCELLED" || p.status === "COMPLETED") throw new ActionError(`Project ${p.code} is ${p.status.toLowerCase()}.`);
  return p;
}

/* ------------------------------------ register ------------------------------------ */

const assetSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the name, for example CAT 320 excavator."),
  kind: z.enum(AssetKind), type: z.string().trim().min(2, "Enter the type, for example Tipper truck."),
  registration: optionalText, ownership: z.enum(Ownership), purchasePrice: optionalAmount,
  fuelType: optionalText, driver: optionalText, status: z.enum(AssetStatus),
  insuranceExpiry: optionalDate, nextServiceDate: optionalDate, notes: optionalText,
});

export async function saveAsset(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const v = assetSchema.parse(formObject(fd));
    if (v.kind === "VEHICLE" && !v.registration) throw new ActionError("Enter the plate number for a vehicle.");
    const data = {
      name: v.name, kind: v.kind, type: v.type, registration: v.registration ?? null, ownership: v.ownership,
      purchasePrice: v.purchasePrice == null ? null : D(v.purchasePrice), fuelType: v.fuelType ?? null, driver: v.driver ?? null,
      status: v.status, insuranceExpiry: v.insuranceExpiry ?? null, nextServiceDate: v.nextServiceDate ?? null, notes: v.notes ?? null,
    };
    return db.$transaction(async (tx) => {
      if (v.registration) {
        const clash = await tx.asset.findFirst({ where: { registration: { equals: v.registration, mode: "insensitive" }, id: v.id ? { not: v.id } : undefined } });
        if (clash) throw new ActionError(`${clash.name} already has the plate number ${v.registration}.`);
      }
      if (v.id) {
        const before = await tx.asset.findUniqueOrThrow({ where: { id: v.id } });
        await tx.asset.update({ where: { id: v.id }, data });
        const moved = before.status !== v.status ? `, status ${before.status.toLowerCase().replace("_", " ")} to ${v.status.toLowerCase().replace("_", " ")}` : "";
        await audit({ userId: user.id, action: "asset.update", entity: "Asset", entityId: v.id, summary: `${user.name} updated ${v.name}${moved}` }, tx);
        refresh();
        return `${v.name} saved`;
      }
      const code = await nextNumber(tx, "AST");
      const a = await tx.asset.create({ data: { ...data, code } });
      await audit({ userId: user.id, action: "asset.create", entity: "Asset", entityId: a.id, summary: `${user.name} added ${a.name} (${a.code})` }, tx);
      refresh();
      return `${a.name} added as ${a.code}`;
    });
  });
}

/* ---------------------------------- project assignment ---------------------------------- */

const assignSchema = z.object({ assetId: z.string(), projectId: z.string().min(1, "Choose the project."), startDate: date, endDate: optionalDate });

export async function assignAsset(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const v = assignSchema.parse(formObject(fd));
    await assertProject(user, v.projectId);
    if (v.endDate && v.endDate < v.startDate) throw new ActionError("The end date cannot be before the start date.");
    return db.$transaction(async (tx) => {
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: v.assetId } });
      if (asset.status === "RETIRED") throw new ActionError(`${asset.name} is retired.`);
      const project = await openProject(tx, v.projectId);
      // An asset can only be in one place at a time: refuse any assignment that overlaps another.
      const clash = await tx.assetAssignment.findFirst({
        where: { assetId: v.assetId, startDate: v.endDate ? { lte: v.endDate } : undefined, OR: [{ endDate: null }, { endDate: { gte: v.startDate } }] },
        include: { project: true },
      });
      if (clash) throw new ActionError(`${asset.name} is already on ${clash.project.code} from ${fmtDate(clash.startDate)}${clash.endDate ? " to " + fmtDate(clash.endDate) : " with no end date"}. Release it there first.`);
      await tx.assetAssignment.create({ data: { assetId: v.assetId, projectId: v.projectId, startDate: v.startDate, endDate: v.endDate ?? null, createdById: user.id } });
      await audit({ userId: user.id, action: "asset.assign", entity: "Asset", entityId: asset.id, summary: `${user.name} assigned ${asset.name} to ${project!.code} from ${fmtDate(v.startDate)}` }, tx);
      refresh();
      return `${asset.name} assigned to ${project!.code}`;
    });
  });
}

export async function releaseAsset(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const v = z.object({ id: z.string(), endDate: date }).parse(formObject(fd));
    await assertRecord(user, "assetAssignment", v.id);
    return db.$transaction(async (tx) => {
      const a = await tx.assetAssignment.findUniqueOrThrow({ where: { id: v.id }, include: { asset: true, project: true } });
      if (a.endDate) throw new ActionError("That assignment has already ended.");
      if (v.endDate < a.startDate) throw new ActionError(`It started on ${fmtDate(a.startDate)}, so it cannot end before then.`);
      await tx.assetAssignment.update({ where: { id: v.id }, data: { endDate: v.endDate } });
      await audit({ userId: user.id, action: "asset.release", entity: "Asset", entityId: a.assetId, summary: `${user.name} released ${a.asset.name} from ${a.project.code} on ${fmtDate(v.endDate)}` }, tx);
      refresh();
      return `${a.asset.name} released from ${a.project.code}`;
    });
  });
}

/* ------------------------------------- daily usage ------------------------------------- */

const usageSchema = z.object({
  assetId: z.string(), date, projectId: optionalText, operator: optionalText,
  startReading: z.coerce.number({ error: "Enter the starting reading." }).min(0),
  endReading: z.coerce.number({ error: "Enter the ending reading." }).min(0),
  trips: z.coerce.number().int("Trips must be a whole number.").min(0).max(200).default(0),
  fuelLitres: z.coerce.number().min(0, "Fuel cannot be negative.").max(5000).default(0),
  purpose: optionalText,
});

export async function logUsage(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("usage");
    const v = usageSchema.parse(formObject(fd));
    if (!(await scopeOf(user)).all && !v.projectId) throw new ActionError("Choose the project this is for."); if (v.projectId) await assertProject(user, v.projectId);
    if (v.date > endOfToday()) throw new ActionError("You cannot log work for a future date.");
    if (v.endReading < v.startReading) throw new ActionError("The ending reading cannot be lower than the starting reading.");

    return db.$transaction(async (tx) => {
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: v.assetId } });
      const unit = asset.kind === "VEHICLE" ? "km" : "hours";
      if (!asset.active || asset.status === "RETIRED") throw new ActionError(`${asset.name} is retired.`);
      if (asset.status === "UNDER_REPAIR") throw new ActionError(`${asset.name} is under repair. Mark it available before logging work.`);

      // The project must match where the asset is assigned on that date. With no project chosen, use the assignment.
      const here = await tx.assetAssignment.findFirst({ where: { assetId: v.assetId, startDate: { lte: v.date }, OR: [{ endDate: null }, { endDate: { gte: v.date } }] }, include: { project: true } });
      let projectId = v.projectId ?? null;
      if (here && projectId && projectId !== here.projectId) throw new ActionError(`${asset.name} is assigned to ${here.project.code} on ${fmtDate(v.date)}, not the project you chose.`);
      if (here && !projectId) projectId = here.projectId;
      await openProject(tx, projectId);

      // Meter readings only go up. Catches a mistyped hour meter or odometer.
      const prev = await tx.assetUsage.findFirst({ where: { assetId: v.assetId, date: { lte: v.date } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
      if (prev && D(v.startReading).lessThan(prev.endReading)) throw new ActionError(`The last reading for ${asset.name} was ${prev.endReading} ${unit} on ${fmtDate(prev.date)}. The start reading cannot be lower.`);
      const next = await tx.assetUsage.findFirst({ where: { assetId: v.assetId, date: { gt: v.date } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
      if (next && D(v.endReading).greaterThan(next.startReading)) throw new ActionError(`A later entry on ${fmtDate(next.date)} starts at ${next.startReading} ${unit}. This entry cannot end above that.`);
      if (prev && prev.date.getTime() === v.date.getTime() && D(prev.startReading).equals(v.startReading) && D(prev.endReading).equals(v.endReading)) throw new ActionError("This exact entry is already logged for that day.");

      const units = D(v.endReading).minus(v.startReading);
      await tx.assetUsage.create({ data: {
        assetId: v.assetId, date: v.date, projectId, operator: v.operator ?? null, startReading: D(v.startReading), endReading: D(v.endReading), units,
        trips: v.trips, fuelLitres: D(v.fuelLitres), purpose: v.purpose ?? null, recordedById: user.id,
      } });
      await audit({ userId: user.id, action: "asset.usage", entity: "Asset", entityId: asset.id, summary: `${user.name} logged ${units} ${unit} for ${asset.name} on ${day(v.date)}${v.fuelLitres ? `, ${v.fuelLitres} L fuel` : ""}` }, tx);
      refresh();
      return `${units} ${unit} logged for ${asset.name}`;
    });
  });
}

/* ------------------------------------------ rentals ------------------------------------------ */

const rentalSchema = z.object({
  assetId: z.string().min(1, "Choose the asset being hired."), supplierId: z.string().min(1, "Choose the supplier."), projectId: optionalText,
  startDate: date, endDate: date, rateType: z.enum(RentalRate), rate: money,
  deposit: z.coerce.number().min(0).max(1e9).default(0), extraCharges: z.coerce.number().min(0).max(1e9).default(0), notes: optionalText,
});

export async function createRental(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const v = rentalSchema.parse(formObject(fd));
    if (!(await scopeOf(user)).all && !v.projectId) throw new ActionError("Choose the project this is for."); if (v.projectId) await assertProject(user, v.projectId);
    if (v.endDate < v.startDate) throw new ActionError("The hire cannot end before it starts.");
    return db.$transaction(async (tx) => {
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: v.assetId } });
      await openProject(tx, v.projectId);
      const clash = await tx.rental.findFirst({ where: { assetId: v.assetId, status: { not: "CANCELLED" }, startDate: { lte: v.endDate }, endDate: { gte: v.startDate } } });
      if (clash) throw new ActionError(`${asset.name} already has hire ${clash.number} from ${fmtDate(clash.startDate)} to ${fmtDate(clash.endDate)}, which overlaps.`);

      const { total, periods } = rentalTotal(v.rateType, v.rate, v.startDate, v.endDate, v.extraCharges);
      const number = await nextNumber(tx, "RNT");
      const r = await tx.rental.create({ data: {
        number, assetId: v.assetId, supplierId: v.supplierId, projectId: v.projectId ?? null, startDate: v.startDate, endDate: v.endDate,
        rateType: v.rateType, rate: D(v.rate), deposit: D(v.deposit), extraCharges: D(v.extraCharges), total, notes: v.notes ?? null, createdById: user.id,
      } });
      if (asset.ownership !== "HIRED") await tx.asset.update({ where: { id: asset.id }, data: { ownership: "HIRED" } });
      await audit({ userId: user.id, action: "rental.create", entity: "Rental", entityId: r.id, summary: `${user.name} recorded hire ${number} of ${asset.name}: ${periods} ${v.rateType.toLowerCase()} period${periods === 1 ? "" : "s"}, total ${fmt2(total)}` }, tx);
      refresh();
      return `${number} recorded, total ${fmt2(total)}`;
    });
  });
}

// The hire cost becomes a draft expense, so it is approved and paid like any other cost and counts against the project.
export async function raiseRentalExpense(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const { id } = z.object({ id: z.string() }).parse(formObject(fd));
    await assertRecord(user, "rental", id);
    return db.$transaction(async (tx) => {
      const r = await tx.rental.findUniqueOrThrow({ where: { id }, include: { asset: true, supplier: true } });
      if (r.expenseId) throw new ActionError(`An expense has already been raised for ${r.number}.`);
      if (r.status === "CANCELLED") throw new ActionError(`${r.number} is cancelled.`);
      if (r.total.lessThanOrEqualTo(0)) throw new ActionError("The hire total is zero, so there is nothing to claim.");
      await openProject(tx, r.projectId);
      const category = r.asset.kind === "VEHICLE" ? "TRUCK_RENTAL" : "EQUIPMENT_RENTAL";
      const account = await tx.account.findUniqueOrThrow({ where: { code: CATEGORY_ACCOUNT[category] } });
      const number = await nextNumber(tx, "EXP");
      const e = await tx.expense.create({ data: {
        number, date: r.endDate < new Date() ? r.endDate : new Date(), projectId: r.projectId, category, supplierId: r.supplierId, assetId: r.assetId,
        description: `Hire of ${r.asset.name}, ${fmtDate(r.startDate)} to ${fmtDate(r.endDate)} (${r.number})`, amount: r.total, accountId: account.id, createdById: user.id,
      } });
      await tx.rental.update({ where: { id }, data: { expenseId: e.id } });
      await audit({ userId: user.id, action: "rental.expense", entity: "Rental", entityId: id, summary: `${user.name} raised draft expense ${number} for ${r.number} (${fmt2(r.total)})` }, tx);
      refresh();
      return `Draft expense ${number} raised for ${fmt2(r.total)}. Submit it for approval from Expenses.`;
    });
  });
}

export async function closeRental(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const { id, to } = z.object({ id: z.string(), to: z.enum(["END", "CANCEL"]) }).parse(formObject(fd));
    await assertRecord(user, "rental", id);
    return db.$transaction(async (tx) => {
      const r = await tx.rental.findUniqueOrThrow({ where: { id } });
      if (r.status !== "ACTIVE") throw new ActionError(`${r.number} is already ${r.status.toLowerCase()}.`);
      if (to === "CANCEL" && r.expenseId) throw new ActionError(`An expense was raised for ${r.number}. Void that expense first, then cancel the hire.`);
      await tx.rental.update({ where: { id }, data: { status: to === "END" ? "ENDED" : "CANCELLED" } });
      await audit({ userId: user.id, action: `rental.${to.toLowerCase()}`, entity: "Rental", entityId: id, summary: `${user.name} ${to === "END" ? "closed" : "cancelled"} hire ${r.number}` }, tx);
      refresh();
      return to === "END" ? `${r.number} closed` : `${r.number} cancelled`;
    });
  });
}

/* ----------------------------------------- maintenance ----------------------------------------- */

const maintSchema = z.object({
  assetId: z.string(), date, kind: z.enum(MaintenanceKind), description: z.string().trim().min(3, "Describe the work done."),
  cost: z.coerce.number().min(0, "Cost cannot be negative.").max(1e9).default(0), nextServiceDate: optionalDate, projectId: optionalText,
  underRepair: z.string().optional(),
});

export async function logMaintenance(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const user = await requireWrite("assets");
    const v = maintSchema.parse(formObject(fd));
    if (v.date > endOfToday()) throw new ActionError("You cannot record maintenance for a future date.");
    if (v.nextServiceDate && v.nextServiceDate <= v.date) throw new ActionError("The next service date must be after this one.");

    return db.$transaction(async (tx) => {
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: v.assetId } });
      await openProject(tx, v.projectId);
      let expenseId: string | null = null;
      if (v.cost > 0) {
        const category = asset.kind === "VEHICLE" ? "VEHICLE_MAINTENANCE" : "EQUIPMENT_MAINTENANCE";
        const account = await tx.account.findUniqueOrThrow({ where: { code: CATEGORY_ACCOUNT[category] } });
        const number = await nextNumber(tx, "EXP");
        const e = await tx.expense.create({ data: {
          number, date: v.date, projectId: v.projectId ?? null, category, assetId: asset.id, description: `${v.kind === "SERVICE" ? "Service" : "Repair"}: ${v.description} (${asset.name})`,
          amount: D(v.cost), accountId: account.id, createdById: user.id,
        } });
        expenseId = e.id;
      }
      await tx.maintenanceRecord.create({ data: { assetId: asset.id, date: v.date, kind: v.kind, description: v.description, cost: D(v.cost), nextServiceDate: v.nextServiceDate ?? null, expenseId, createdById: user.id } });
      await tx.asset.update({ where: { id: asset.id }, data: {
        ...(v.nextServiceDate ? { nextServiceDate: v.nextServiceDate } : {}),
        ...(v.underRepair === "on" ? { status: "UNDER_REPAIR" as const } : {}),
      } });
      await audit({ userId: user.id, action: "asset.maintenance", entity: "Asset", entityId: asset.id, summary: `${user.name} logged ${v.kind.toLowerCase()} on ${asset.name}${v.cost > 0 ? ` costing ${fmt2(v.cost)}` : ""}${v.underRepair === "on" ? ", marked under repair" : ""}` }, tx);
      refresh();
      return v.cost > 0 ? "Maintenance logged. A draft expense was raised for the cost." : "Maintenance logged";
    });
  });
}
