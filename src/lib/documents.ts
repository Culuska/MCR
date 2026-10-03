import { db } from "@/lib/db";
import { projectCosting } from "@/lib/finance";
import { CATEGORY_LABEL, METHOD_LABEL, label } from "@/lib/domain";
import { D, fmt2, fmtDate, sum } from "@/lib/money";
import { revisedValue } from "@/lib/subcontract";
import { banner, finish, heading, letterhead, newDoc, pairs, signatures, table, safe } from "@/lib/pdf";

// The documents people hand to others: an invoice, a project statement, payslips and a payment certificate.
// Every figure is read from the same calculations the screens use, so a PDF can never disagree with the app.

export type Pdf = { filename: string; bytes: Buffer };
export class DocumentError extends Error { constructor(message: string, readonly status = 409) { super(message); } }

const clean = (s: string) => s.replace(" (sample)", "");

export async function invoicePdf(id: string): Promise<Pdf | null> {
  const inv = await db.invoice.findUnique({ where: { id }, include: { customer: true, project: true, payments: { where: { voided: false }, orderBy: { date: "asc" } } } });
  if (!inv) return null;
  const paid = sum(inv.payments.map((p) => p.amount));
  const balance = D(inv.amount).minus(paid);

  const doc = newDoc(`Invoice ${inv.number}`);
  letterhead(doc, "INVOICE", [["Invoice no.", inv.number], ["Issued", fmtDate(inv.issueDate)], ["Due", fmtDate(inv.dueDate)], ["Status", label(inv.status)]]);
  if (inv.status === "DRAFT") banner(doc, "DRAFT. Not yet issued to the customer.", "#a86400");
  if (inv.status === "VOID") banner(doc, "VOID. This invoice has been cancelled.");

  heading(doc, "Bill to");
  doc.font("Helvetica-Bold").fontSize(11).text(safe(clean(inv.customer.name)));
  doc.font("Helvetica").fontSize(9.5);
  for (const line of [inv.customer.contact, inv.customer.phone, inv.customer.email, inv.customer.address]) if (line) doc.text(safe(line));

  heading(doc, "Project");
  doc.text(safe(`${inv.project.code}  ${clean(inv.project.name)}`));
  if (inv.project.location) doc.fillColor("#5a6677").text(safe(inv.project.location)).fillColor("#16202c");

  doc.moveDown(1);
  table(doc, [{ label: "Description", width: 395 }, { label: "Amount (USD)", width: 100, align: "right" }], [[inv.notes?.trim() || `Works on ${clean(inv.project.name)}`, fmt2(inv.amount)]], { totals: ["Invoice total", fmt2(inv.amount)] });

  if (inv.payments.length) {
    heading(doc, "Payments received");
    table(doc, [{ label: "Date", width: 90 }, { label: "Method", width: 120 }, { label: "Reference", width: 185 }, { label: "Amount", width: 100, align: "right" }],
      inv.payments.map((p) => [fmtDate(p.date), METHOD_LABEL[p.method], p.reference ?? "", fmt2(p.amount)]));
  }
  doc.moveDown(0.8);
  pairs(doc, [["Total invoiced", fmt2(inv.amount)], ["Received to date", fmt2(paid)]]);
  doc.moveDown(0.3).font("Helvetica-Bold").fontSize(13).fillColor("#16202c").text(`Balance due   ${fmt2(balance)}`, 48, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor("#5a6677").moveDown(1).text("Please quote the invoice number with your payment.", 48);
  return { filename: `${inv.number}.pdf`, bytes: await finish(doc) };
}

export async function projectStatementPdf(id: string): Promise<Pdf | null> {
  if (!(await db.project.findUnique({ where: { id }, select: { id: true } }))) return null;
  const c = await projectCosting(id);
  const p = c.project;
  const doc = newDoc(`Project statement ${p.code}`);
  letterhead(doc, "PROJECT STATEMENT", [["Project", p.code], ["Status", label(p.status)], ["Progress", `${p.progress}%`]]);
  doc.font("Helvetica-Bold").fontSize(13).text(safe(clean(p.name)));
  doc.font("Helvetica").fontSize(9.5).fillColor("#5a6677").text(safe([p.customer ? clean(p.customer.name) : null, p.location].filter(Boolean).join(" · ") || " ")).fillColor("#16202c");

  heading(doc, "Position");
  pairs(doc, [
    ["Contract value", fmt2(c.contract)], ["Invoiced to date", fmt2(c.invoiced)], ["Received to date", fmt2(c.received)],
    ["Cost to date", fmt2(c.cost)], ["Profit to date (invoiced less cost)", fmt2(c.actualProfit)],
    ["Expected final cost", fmt2(c.expectedFinalCost)], ["Expected profit at completion", fmt2(c.expectedProfit)],
  ], { labelWidth: 230 });

  heading(doc, "Budget against actual");
  table(doc, [{ label: "Category", width: 150 }, { label: "Budget", width: 85, align: "right" }, { label: "Spent", width: 85, align: "right" }, { label: "Remaining", width: 90, align: "right" }, { label: "Used", width: 85, align: "right" }],
    c.lines.map((l) => [CATEGORY_LABEL[l.category], l.budget.isZero() ? "none" : fmt2(l.budget), fmt2(l.spent), fmt2(l.remaining), l.budget.isZero() ? "not budgeted" : `${Math.round(l.used)}%`]),
    { totals: ["Total", fmt2(c.budget), fmt2(c.cost), fmt2(c.costVariance), `${Math.round(c.budgetUsed)}%`], zebra: true });
  doc.moveDown(1).font("Helvetica").fontSize(8.5).fillColor("#5a6677").text("Cost counts approved and paid expenses, wages from approved payroll, material used on the project, certified subcontract work, and equipment costs charged to it. Expected final cost assumes spending keeps pace with site progress.", 48, doc.y, { width: 495 });
  return { filename: `${p.code}-statement.pdf`, bytes: await finish(doc) };
}

export async function payslipsPdf(runId: string): Promise<Pdf | null> {
  const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { lines: { include: { employee: true }, orderBy: { employee: { code: "asc" } } } } });
  if (!run) return null;
  if (run.status === "DRAFT") throw new DocumentError(`${run.number} has not been approved yet, so payslips cannot be issued.`);
  if (run.status === "VOID") throw new DocumentError(`${run.number} was voided, so it has no payslips.`);

  const doc = newDoc(`Payslips ${run.number}`);
  run.lines.forEach((l, i) => {
    if (i > 0) doc.addPage();
    const e = l.employee;
    letterhead(doc, "PAYSLIP", [["Payroll run", run.number], ["Period", `${fmtDate(run.periodStart)} to ${fmtDate(run.periodEnd)}`], ["Status", run.status === "PAID" ? `Paid ${fmtDate(run.paidAt)}` : "Approved"]]);
    heading(doc, "Employee");
    pairs(doc, [["Name", clean(e.name)], ["Employee no.", e.code], ["Position", e.position], ["Paid", e.payType === "DAILY" ? `Daily wage ${fmt2(e.rate)}` : `Monthly salary ${fmt2(e.rate)}`]]);

    heading(doc, "Earnings");
    const basis = e.payType === "DAILY" ? `${l.paidDays} days at ${fmt2(e.rate)}` : `${l.paidDays} days at ${fmt2(D(e.rate).div(26))} (salary / 26)`;
    table(doc, [{ label: "Item", width: 280 }, { label: "Basis", width: 125 }, { label: "Amount", width: 90, align: "right" }], [
      ["Basic pay", basis, fmt2(l.basePay)],
      ["Overtime", `${l.overtimeHours} hours at ${fmt2(e.overtimeRate)}`, fmt2(l.overtimePay)],
      ["Bonus", "", fmt2(l.bonus)],
    ], { totals: ["Gross pay", "", fmt2(l.gross)] });

    heading(doc, "Deductions");
    table(doc, [{ label: "Item", width: 405 }, { label: "Amount", width: 90, align: "right" }], [["Deductions", fmt2(l.deductions)], ["Advance recovered", fmt2(l.advanceRecovered)]],
      { totals: ["Total deductions", fmt2(D(l.deductions).plus(l.advanceRecovered))] });

    doc.moveDown(1).font("Helvetica-Bold").fontSize(16).fillColor("#1c5db0").text(`NET PAY   ${fmt2(l.net)}`, 48, doc.y);
    doc.fillColor("#16202c");
    signatures(doc, ["Employee signature", "Authorised by"]);
  });
  return { filename: `${run.number}-payslips.pdf`, bytes: await finish(doc) };
}

export async function certificatePdf(id: string): Promise<Pdf | null> {
  const c = await db.subCertificate.findUnique({ where: { id }, include: { subcontract: { include: { supplier: true, project: true, variations: true } } } });
  if (!c) return null;
  const s = c.subcontract;
  const users = await db.user.findMany({ where: { id: { in: [c.createdById, ...(c.approvedById ? [c.approvedById] : [])] } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "";
  const approved = s.variations.filter((v) => v.approved);
  const revised = revisedValue(s.contractValue, approved.map((v) => v.amount));
  const previous = D(c.workToDate).minus(c.gross);

  const doc = newDoc(`Payment certificate ${c.number}`);
  letterhead(doc, "PAYMENT CERTIFICATE", [["Certificate", c.number], ["Valuation no.", String(c.seq)], ["Date", fmtDate(c.date)], ["Status", label(c.status)]]);
  if (c.status === "DRAFT") banner(doc, "DRAFT. Not yet approved for payment.", "#a86400");
  if (c.status === "VOID") banner(doc, "VOID. This certificate has been cancelled.");

  heading(doc, "Subcontract");
  pairs(doc, [["Reference", s.number], ["Subcontractor", clean(s.supplier.name)], ["Project", `${s.project.code}  ${clean(s.project.name)}`], ["Scope of work", s.scope]]);

  heading(doc, "Contract value");
  pairs(doc, [["Original contract value", fmt2(s.contractValue)], ...approved.map((v): [string, string] => [`Variation: ${v.description}`.slice(0, 60), fmt2(v.amount)]), ["Revised contract value", fmt2(revised)]], { labelWidth: 280 });

  heading(doc, "This certificate");
  table(doc, [{ label: "Item", width: 395 }, { label: "Amount (USD)", width: 100, align: "right" }], [
    ["Value of work done to date", fmt2(c.workToDate)],
    ["Less: previously certified", fmt2(previous)],
    ["Value of work in this certificate", fmt2(c.gross)],
    [`Less: retention withheld (${s.retentionPct}%)`, fmt2(c.retention)],
  ], { totals: ["NET PAYABLE NOW", fmt2(c.net)] });
  doc.moveDown(0.8);
  pairs(doc, [["Percent of contract complete", `${revised.isZero() ? 0 : D(c.workToDate).div(revised).times(100).toFixed(1)}%`], ["Still to certify", fmt2(revised.minus(c.workToDate))]], { labelWidth: 230 });
  if (c.paidAt) pairs(doc, [["Paid", `${fmtDate(c.paidAt)}${c.payMethod ? " by " + METHOD_LABEL[c.payMethod] : ""}${c.payReference ? ", ref " + c.payReference : ""}`]], { labelWidth: 230 });
  if (c.notes) { heading(doc, "Notes"); doc.text(safe(c.notes), 48, doc.y, { width: 495 }); }
  signatures(doc, [`Prepared by ${nameOf(c.createdById)}`.trim(), `Approved by ${nameOf(c.approvedById)}`.trim(), "Subcontractor"]);
  return { filename: `${c.number}.pdf`, bytes: await finish(doc) };
}
