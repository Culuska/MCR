import { db } from "@/lib/db";
import { D, ZERO, sum, pct, fmt, type Money } from "@/lib/money";
import { SYS } from "@/lib/domain";
import { behindSchedule, retentionHeld, revisedValue } from "@/lib/subcontract";
import { previousWorkingDay } from "@/lib/operations";
import { siteAlerts, todayUtc } from "@/lib/site";
import type { ExpenseCategory, AccountType } from "@/generated/prisma/client";

// Every number shown on a dashboard or report comes from this file, so pages cannot disagree.

const COST_STATUSES = ["APPROVED", "PAID"] as const; // an approved expense is a real cost, paid or not

export const alertLevel = (used: number): 0 | 80 | 90 | 100 => (used >= 100 ? 100 : used >= 90 ? 90 : used >= 80 ? 80 : 0);
const maxOf = (a: Money, b: Money) => (a.greaterThan(b) ? a : b);

export async function ledgerBalances() {
  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
  const grouped = await db.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } });
  const byId = new Map(grouped.map((g) => [g.accountId, g._sum]));
  return accounts.map((a) => {
    const s = byId.get(a.id);
    const debit = D(s?.debit), credit = D(s?.credit);
    // Assets and expenses grow on the debit side; everything else on the credit side.
    const balance: Money = a.type === "ASSET" || a.type === "EXPENSE" ? debit.minus(credit) : credit.minus(debit);
    return { ...a, debit, credit, balance };
  });
}

export async function companyPosition() {
  const rows = await ledgerBalances();
  const bal = (code: string) => rows.find((r) => r.code === code)?.balance ?? ZERO;
  const total = (t: AccountType) => sum(rows.filter((r) => r.type === t).map((r) => r.balance));
  const cash = sum(rows.filter((r) => r.isCash).map((r) => r.balance));
  const revenue = total("INCOME"), expenses = total("EXPENSE");
  return {
    cash, receivable: bal(SYS.AR), payable: bal(SYS.AP),
    revenue, expenses, netProfit: revenue.minus(expenses),
    assets: total("ASSET"), liabilities: total("LIABILITY"), equity: total("EQUITY"),
    rows,
  };
}

export async function projectCosting(projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { budget: true, customer: true } });
  const spentByCat = await db.expense.groupBy({
    by: ["category"], where: { projectId, status: { in: [...COST_STATUSES] }, category: { not: "STOCK_PURCHASE" } }, _sum: { amount: true },
  });
  const actual = new Map<ExpenseCategory, Money>(spentByCat.map((e) => [e.category, D(e._sum.amount)]));
  // Wages from approved and paid payroll runs count as this project's labour cost.
  const payroll = await db.payrollAllocation.aggregate({ where: { projectId, line: { run: { status: { in: [...COST_STATUSES] } } } }, _sum: { amount: true } });
  if (payroll._sum.amount) actual.set("WAGES", (actual.get("WAGES") ?? ZERO).plus(D(payroll._sum.amount)));
  // Approved subcontract certificates are the project's subcontractor cost, at their full gross value (retention included).
  const certs = await db.subCertificate.aggregate({ where: { subcontract: { projectId }, status: { in: [...COST_STATUSES] } }, _sum: { gross: true } });
  if (certs._sum.gross) actual.set("SUBCONTRACTORS", (actual.get("SUBCONTRACTORS") ?? ZERO).plus(D(certs._sum.gross)));
  // Material issued from stock to this project is its materials cost, at the average cost on the day it was issued.
  const issued = await db.stockMovement.aggregate({ where: { projectId, type: "ISSUE", voided: false }, _sum: { value: true } });
  if (issued._sum.value) actual.set("MATERIALS", (actual.get("MATERIALS") ?? ZERO).plus(D(issued._sum.value)));
  const budgetMap = new Map<ExpenseCategory, Money>(project.budget.map((b) => [b.category, D(b.amount)]));
  const categories = [...new Set<ExpenseCategory>([...actual.keys(), ...budgetMap.keys()])];

  const lines = categories.map((category) => {
    const budget = budgetMap.get(category) ?? ZERO, spent = actual.get(category) ?? ZERO;
    const used = budget.isZero() ? (spent.isZero() ? 0 : 999) : pct(spent, budget);
    return { category, budget, spent, remaining: budget.minus(spent), used, level: alertLevel(used) };
  }).sort((a, b) => b.spent.comparedTo(a.spent));

  const budget = sum(project.budget.map((b) => b.amount));
  const cost = sum([...actual.values()]);
  const invoicedRows = await db.invoice.findMany({ where: { projectId, status: { notIn: ["VOID", "DRAFT"] } }, select: { amount: true } });
  const receivedRows = await db.payment.findMany({ where: { kind: "RECEIPT", voided: false, invoice: { projectId } }, select: { amount: true } });
  const invoiced = sum(invoicedRows.map((i) => i.amount));
  const received = sum(receivedRows.map((p) => p.amount));

  // Expected final cost: if the work is X% done, assume cost keeps pace, but never below what is already spent.
  const progress = project.progress;
  const projected = progress > 0 && progress < 100 ? maxOf(cost, cost.div(progress).times(100)) : cost;
  const contract = D(project.contractValue);

  return {
    project, lines, contract, budget, cost, invoiced, received,
    costVariance: budget.minus(cost), budgetUsed: pct(cost, budget),
    actualProfit: invoiced.minus(cost), expectedFinalCost: projected, expectedProfit: contract.minus(projected),
  };
}

export async function allProjectsSummary() {
  const projects = await db.project.findMany({ orderBy: { code: "asc" } });
  return Promise.all(projects.map((p) => projectCosting(p.id)));
}

export async function receivables() {
  const open = await db.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIAL"] } },
    include: { customer: true, project: true, payments: { where: { voided: false } } },
    orderBy: { dueDate: "asc" },
  });
  const now = new Date();
  return open.map((i) => {
    const paid = sum(i.payments.map((p) => p.amount));
    const daysLate = Math.max(0, Math.floor((now.getTime() - i.dueDate.getTime()) / 86400000));
    const age = daysLate === 0 ? "Not due" : daysLate <= 30 ? "1–30 days" : daysLate <= 60 ? "31–60 days" : "Over 60 days";
    return { ...i, paid, outstanding: D(i.amount).minus(paid), overdue: i.dueDate < now, daysLate, age };
  });
}

export const AGE_BUCKETS = ["Not due", "1–30 days", "31–60 days", "Over 60 days"] as const;

export async function payables() {
  const open = await db.expense.findMany({
    where: { status: "APPROVED" },
    include: { supplier: true, project: true, payments: { where: { voided: false } } },
    orderBy: { date: "asc" },
  });
  return open.map((e) => {
    const paid = sum(e.payments.map((p) => p.amount));
    return { ...e, paid, outstanding: D(e.amount).minus(paid) };
  });
}

// Cash movements by month from the cash and bank accounts: debit = money in, credit = money out.
export async function cashFlow(months = 6) {
  const from = new Date(); from.setDate(1); from.setMonth(from.getMonth() - (months - 1)); from.setHours(0, 0, 0, 0);
  const lines = await db.journalLine.findMany({
    where: { account: { isCash: true } }, select: { debit: true, credit: true, entry: { select: { date: true } } },
  });
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const buckets = new Map<string, { in: Money; out: Money }>();
  let opening = ZERO;
  for (const l of lines) {
    if (l.entry.date < from) { opening = opening.plus(D(l.debit)).minus(D(l.credit)); continue; }
    const k = key(l.entry.date);
    const b = buckets.get(k) ?? { in: ZERO, out: ZERO };
    buckets.set(k, { in: b.in.plus(D(l.debit)), out: b.out.plus(D(l.credit)) });
  }
  const out = [];
  let running = opening;
  for (let i = 0; i < months; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const b = buckets.get(key(d)) ?? { in: ZERO, out: ZERO };
    const start = running;
    running = running.plus(b.in).minus(b.out);
    out.push({ key: key(d), label: d.toLocaleDateString("en-GB", { month: "short" }), opening: start, in: b.in, out: b.out, closing: running });
  }
  return out;
}

export async function expenseBreakdown() {
  const g = await db.expense.groupBy({ by: ["category"], where: { status: { in: [...COST_STATUSES] }, category: { not: "STOCK_PURCHASE" } }, _sum: { amount: true } });
  const totals = new Map<ExpenseCategory, Money>(g.map((x) => [x.category, D(x._sum.amount)]));
  const payroll = await db.payrollAllocation.aggregate({ where: { line: { run: { status: { in: [...COST_STATUSES] } } } }, _sum: { amount: true } });
  if (payroll._sum.amount) totals.set("WAGES", (totals.get("WAGES") ?? ZERO).plus(D(payroll._sum.amount)));
  const certs = await db.subCertificate.aggregate({ where: { status: { in: [...COST_STATUSES] } }, _sum: { gross: true } });
  if (certs._sum.gross) totals.set("SUBCONTRACTORS", (totals.get("SUBCONTRACTORS") ?? ZERO).plus(D(certs._sum.gross)));
  const issued = await db.stockMovement.aggregate({ where: { type: "ISSUE", voided: false }, _sum: { value: true } });
  if (issued._sum.value) totals.set("MATERIALS", (totals.get("MATERIALS") ?? ZERO).plus(D(issued._sum.value)));
  return [...totals.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total.comparedTo(a.total));
}

export async function alerts() {
  const out: { tone: "bad" | "warn"; text: string; href: string }[] = [];
  // A cash or bank account below zero means money was paid out that was never recorded as received.
  for (const a of (await ledgerBalances()).filter((r) => r.isCash && r.balance.isNegative())) {
    out.push({ tone: "bad", text: `${a.name} is overdrawn by ${fmt(a.balance.abs())}. Check receipts and transfers are recorded.`, href: "/finance?tab=cash" });
  }
  for (const s of await allProjectsSummary()) {
    if (s.project.status === "CANCELLED" || s.project.status === "COMPLETED") continue;
    for (const l of s.lines.filter((x) => x.level >= 90 && !x.budget.isZero())) {
      out.push({ tone: l.level === 100 ? "bad" : "warn", text: `${s.project.code}: ${l.category.toLowerCase().replace(/_/g, " ")} at ${Math.round(l.used)}% of budget`, href: `/projects/${s.project.id}` });
    }
  }
  for (const i of (await receivables()).filter((x) => x.overdue)) {
    out.push({ tone: "bad", text: `Invoice ${i.number} from ${i.customer.name} is overdue (${fmt(i.outstanding)} outstanding)`, href: "/invoices" });
  }
  const pending = await db.expense.count({ where: { status: "SUBMITTED" } });
  if (pending) out.push({ tone: "warn", text: `${pending} expense${pending === 1 ? "" : "s"} waiting for approval`, href: "/expenses?status=SUBMITTED" });
  const late = await db.project.count({ where: { status: "ACTIVE", expectedEnd: { lt: new Date() } } });
  if (late) out.push({ tone: "warn", text: `${late} active project${late === 1 ? " is" : "s are"} past the planned finish date`, href: "/projects" });
  const soon = (days: number) => new Date(Date.now() + days * 86400000);
  for (const a of await db.asset.findMany({ where: { active: true, status: { not: "RETIRED" }, OR: [{ nextServiceDate: { lte: soon(14) } }, { insuranceExpiry: { lte: soon(30) } }] } })) {
    if (a.nextServiceDate && a.nextServiceDate <= soon(14)) out.push({ tone: a.nextServiceDate < new Date() ? "bad" : "warn", text: `${a.name} ${a.nextServiceDate < new Date() ? "service is overdue" : "is due for service"} (${a.nextServiceDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`, href: `/assets/${a.id}` });
    if (a.insuranceExpiry && a.insuranceExpiry <= soon(30)) out.push({ tone: a.insuranceExpiry < new Date() ? "bad" : "warn", text: `${a.name} insurance ${a.insuranceExpiry < new Date() ? "has expired" : "expires"} (${a.insuranceExpiry.toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`, href: `/assets/${a.id}` });
  }
  for (const r of await db.rental.findMany({ where: { status: "ACTIVE", endDate: { lte: soon(7) } }, include: { asset: true } })) {
    out.push({ tone: r.endDate < new Date() ? "bad" : "warn", text: `Hire of ${r.asset.name} ${r.endDate < new Date() ? "passed its end date. Close it or record the extension" : "ends soon"} (${r.number})`, href: "/assets?tab=rentals" });
  }
  for (const s of (await subcontractFigures()).filter((x) => x.sub.status === "ACTIVE" || x.sub.status === "COMPLETED")) {
    if (s.drafts > 0) out.push({ tone: "warn", text: `${s.sub.number} (${s.sub.supplier.name}) has a payment certificate waiting for approval`, href: `/subcontracts/${s.sub.id}` });
    if (s.unpaid.greaterThan(0)) out.push({ tone: "warn", text: `${fmt(s.unpaid)} is approved but unpaid on ${s.sub.number} (${s.sub.supplier.name})`, href: `/subcontracts/${s.sub.id}` });
    if (s.sub.status === "ACTIVE" && s.behind.greaterThan(0)) out.push({ tone: "warn", text: `${s.sub.number} is behind its payment programme by ${fmt(s.behind)} of certified work`, href: `/subcontracts/${s.sub.id}` });
    if (s.sub.status === "COMPLETED" && s.retentionHeld.greaterThan(0)) out.push({ tone: "warn", text: `${fmt(s.retentionHeld)} retention is still held on completed ${s.sub.number}`, href: `/subcontracts/${s.sub.id}` });
  }
  const today = todayUtc();
  out.push(...(await siteAlerts(previousWorkingDay(today), today)));
  const materials = await db.material.findMany({ where: { active: true, reorderLevel: { gt: 0 } } });
  for (const m of materials.filter((x) => D(x.onHand).lessThanOrEqualTo(D(x.reorderLevel)))) {
    out.push({ tone: D(m.onHand).isZero() ? "bad" : "warn", text: `${m.name} is ${D(m.onHand).isZero() ? "out of stock" : "low"}: ${D(m.onHand).toString()} ${m.unit} left, reorder at ${D(m.reorderLevel).toString()}`, href: "/materials" });
  }
  for (const r of (await db.payrollRun.findMany({ where: { status: "APPROVED" } }))) {
    out.push({ tone: "warn", text: `Payroll ${r.number} is approved but not yet paid`, href: `/payroll/${r.id}` });
  }
  return out.sort((a, b) => (a.tone === "bad" ? 0 : 1) - (b.tone === "bad" ? 0 : 1)); // red first
}

// Running cost of every machine and vehicle: approved and paid expenses tagged to it, against the work logged.
export async function assetCosting() {
  const now = new Date();
  const [assets, costs, usage] = await Promise.all([
    db.asset.findMany({
      where: { active: true }, orderBy: { code: "asc" },
      include: { assignments: { where: { startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] }, include: { project: true } } },
    }),
    db.expense.groupBy({ by: ["assetId", "category"], where: { assetId: { not: null }, status: { in: [...COST_STATUSES] } }, _sum: { amount: true } }),
    db.assetUsage.groupBy({ by: ["assetId"], _sum: { units: true, fuelLitres: true, trips: true } }),
  ]);
  return assets.map((asset) => {
    const mine = costs.filter((c) => c.assetId === asset.id);
    const by = (cats: ExpenseCategory[]) => sum(mine.filter((c) => cats.includes(c.category)).map((c) => c._sum.amount));
    const u = usage.find((x) => x.assetId === asset.id)?._sum;
    const units = D(u?.units), litres = D(u?.fuelLitres);
    const cost = sum(mine.map((c) => c._sum.amount));
    return {
      asset, project: asset.assignments[0]?.project ?? null, cost, units, litres, trips: u?.trips ?? 0,
      fuel: by(["FUEL"]), hire: by(["EQUIPMENT_RENTAL", "TRUCK_RENTAL"]), maintenance: by(["EQUIPMENT_MAINTENANCE", "VEHICLE_MAINTENANCE"]),
      other: cost.minus(by(["FUEL", "EQUIPMENT_RENTAL", "TRUCK_RENTAL", "EQUIPMENT_MAINTENANCE", "VEHICLE_MAINTENANCE"])),
      costPerUnit: units.isZero() ? null : cost.div(units), litresPerUnit: units.isZero() ? null : litres.div(units),
    };
  });
}

export async function fuelByProject() {
  const g = await db.assetUsage.groupBy({ by: ["projectId"], _sum: { fuelLitres: true, units: true } });
  const projects = await db.project.findMany({ select: { id: true, code: true, name: true } });
  return g.map((x) => ({ project: projects.find((p) => p.id === x.projectId) ?? null, litres: D(x._sum.fuelLitres), units: D(x._sum.units) }))
    .filter((x) => x.litres.greaterThan(0)).sort((a, b) => b.litres.comparedTo(a.litres));
}

// What is in the store, what it is worth, and how that compares with Inventory in the ledger.
export async function stockSummary() {
  const [materials, ledger, bills] = await Promise.all([
    db.material.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.account.findUnique({ where: { code: SYS.INVENTORY } }),
    db.expense.aggregate({ where: { category: "STOCK_PURCHASE", status: { in: ["DRAFT", "SUBMITTED"] } }, _sum: { amount: true } }),
  ]);
  const rows = materials.map((m) => ({ ...m, value: D(m.onHand).times(D(m.avgCost)) }));
  const value = sum(rows.map((r) => r.value));
  const lines = ledger ? await db.journalLine.aggregate({ where: { accountId: ledger.id }, _sum: { debit: true, credit: true } }) : null;
  const inLedger = D(lines?._sum.debit).minus(D(lines?._sum.credit));
  const awaiting = D(bills._sum.amount); // delivered and in stock, supplier bill not yet approved (held as "goods received, not invoiced")
  return { rows, value, inLedger, awaiting, difference: value.minus(inLedger) };
}

// Every figure about a subcontract, from its variations, certificates and retention releases.
export async function subcontractFigures(projectId?: string) {
  const subs = await db.subcontract.findMany({
    where: { projectId, status: { not: "CANCELLED" } }, orderBy: { number: "asc" },
    include: { supplier: true, project: true, variations: true, schedule: true, certificates: { orderBy: { seq: "asc" } }, releases: { where: { voided: false } } },
  });
  const now = new Date();
  return subs.map((sub) => {
    const live = sub.certificates.filter((c) => c.status !== "VOID");
    const posted = live.filter((c) => c.status === "APPROVED" || c.status === "PAID");
    const revised = revisedValue(sub.contractValue, sub.variations.filter((v) => v.approved).map((v) => v.amount));
    const certified = posted.length ? D(posted[posted.length - 1].workToDate) : ZERO; // cumulative to date
    const held = retentionHeld(posted.map((c) => c.retention), sub.releases.map((r) => r.amount));
    return {
      sub, revised, certified, retentionHeld: held,
      paid: sum(live.filter((c) => c.status === "PAID").map((c) => c.net)),
      unpaid: sum(posted.filter((c) => c.status === "APPROVED").map((c) => c.net)),
      drafts: live.filter((c) => c.status === "DRAFT").length,
      remaining: revised.minus(certified),
      percent: pct(certified, revised),
      pendingVariations: sub.variations.filter((v) => !v.approved).length,
      ...behindSchedule(sub.schedule, certified, now),
    };
  });
}
