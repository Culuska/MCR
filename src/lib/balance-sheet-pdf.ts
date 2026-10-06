import { COMPANY, finish, newDoc, safe } from "@/lib/pdf";
import { fmt2 } from "@/lib/money";
import { dateLabel, shortDate, type BalanceSheet } from "@/lib/balance-sheet";

// The Balance Sheet as a one-or-two-page PDF in the QuickBooks style: centred title block, grouped accounts, totals with rules.

const INK = "#16202c", MUTED = "#5a6677", RULE = "#7b8696";
const M = 48, AMOUNT_W = 96, ROW = 15;

export function balanceSheetPdf(bs: BalanceSheet): Promise<Buffer> {
  const doc = newDoc(`Balance sheet as of ${dateLabel(bs.dates[0])}`);
  const W = doc.page.width - 2 * M;
  const compare = bs.dates.length > 1;
  const cols = compare ? bs.dates.length + 1 : 1; // the dates, plus a Change column when comparing
  const labelW = W - cols * AMOUNT_W;
  const colX = (i: number) => M + labelW + i * AMOUNT_W;
  const heads = compare ? [...bs.dates.map(shortDate), "Change"] : ["Total"];

  const amounts = (a: BalanceSheet["lines"][number]["amounts"]) => (a ? (compare ? [...a, a[0].minus(a[1])] : a).map((m) => fmt2(m)) : []);

  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(safe(COMPANY), M, M, { width: W, align: "center" });
  doc.font("Helvetica-Bold").fontSize(20).text("Balance Sheet", M, doc.y + 4, { width: W, align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`As of ${dateLabel(bs.dates[0])}${compare ? `, compared with ${dateLabel(bs.dates[1])}` : ""}`, M, doc.y + 3, { width: W, align: "center" });
  doc.fontSize(8.5).text("Accrual basis", M, doc.y + 2, { width: W, align: "center" });

  const head = (y: number) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
    heads.forEach((h, i) => doc.text(safe(h.toUpperCase()), colX(i), y, { width: AMOUNT_W - 6, align: "right", lineBreak: false }));
    doc.moveTo(M, y + 14).lineTo(M + W, y + 14).lineWidth(0.6).strokeColor(RULE).stroke();
    return y + 20;
  };
  let y = head(doc.y + 14);

  for (const l of bs.lines) {
    const topGap = l.kind === "title" && l.indent === 0 ? 8 : 0;
    if (y + topGap + ROW > doc.page.height - 64) { doc.addPage(); y = head(M); }
    y += topGap;
    const bold = l.kind !== "row";
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(l.kind === "title" && l.indent === 0 ? 11 : 10).fillColor(INK);
    doc.text(safe(l.label), M + l.indent * 14, y, { width: labelW - l.indent * 14 - 6, height: 12, lineBreak: false, ellipsis: true });
    amounts(l.amounts).forEach((a, i) => doc.text(a, colX(i), y, { width: AMOUNT_W - 6, align: "right", lineBreak: false }));
    if ((l.kind === "total" || l.kind === "grand") && l.amounts) {
      doc.lineWidth(0.6).strokeColor(RULE);
      for (let i = 0; i < cols; i++) doc.moveTo(colX(i) + 8, y - 2).lineTo(colX(i) + AMOUNT_W - 4, y - 2).stroke();
      if (l.kind === "grand") for (let i = 0; i < cols; i++) doc.moveTo(colX(i) + 8, y + 12).lineTo(colX(i) + AMOUNT_W - 4, y + 12).moveTo(colX(i) + 8, y + 14).lineTo(colX(i) + AMOUNT_W - 4, y + 14).stroke();
    }
    y += ROW + (l.kind === "grand" ? 4 : 0);
  }

  if (!bs.balanced) doc.font("Helvetica-Bold").fontSize(9).fillColor("#b3261e").text("Warning: assets do not equal liabilities plus equity.", M, y + 8, { width: W });
  return finish(doc);
}
