import type { Report } from "@/lib/reports";
import { finish, letterhead, newDoc, safe, table, type Col } from "@/lib/pdf";

// Turns any report (title, headers, rows) into a landscape PDF table. The same rows feed the CSV download,
// so the PDF and the spreadsheet can never disagree.

const USABLE = 842 - 96; // A4 landscape width less the page margins
const MAX_ROWS = 5000;

export function reportPdf(r: Report, scope: string[]): Promise<Buffer> {
  const rows = r.rows.slice(0, MAX_ROWS);
  const numeric = r.headers.map((_, i) => rows.length > 0 && rows.every((row) => row[i] == null || row[i] === "" || typeof row[i] === "number"));
  const decimals = r.headers.map((_, i) => numeric[i] && rows.some((row) => typeof row[i] === "number" && !Number.isInteger(row[i])));

  const text = (c: string | number | null | undefined, i: number) => {
    if (c == null || c === "") return "";
    if (typeof c === "number") return c.toLocaleString("en-US", { minimumFractionDigits: decimals[i] ? 2 : 0, maximumFractionDigits: 2 });
    return String(c);
  };
  const body = rows.map((row) => r.headers.map((_, i) => text(row[i], i)));

  const doc = newDoc(r.title, { landscape: true });

  // Column widths come from the real text widths. If the page is too narrow, only the long text columns give way.
  const wide = (font: string, size: number, str: string) => doc.font(font).fontSize(size).widthOfString(str);
  const need = r.headers.map((h, i) => Math.ceil(Math.max(...h.toUpperCase().split(" ").map((w) => wide("Helvetica-Bold", 8, w)), ...body.slice(0, 300).map((row) => wide("Helvetica", 9.5, row[i])), 20)) + 12);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  let widths = need.slice();
  if (sum(widths) > USABLE) {
    const FLOOR = 90;
    const longIdx = widths.map((w, i) => (w > FLOOR ? i : -1)).filter((i) => i >= 0);
    const fixed = sum(widths) - sum(longIdx.map((i) => widths[i]));
    const room = Math.max(USABLE - fixed, FLOOR * longIdx.length);
    const longTotal = sum(longIdx.map((i) => widths[i]));
    for (const i of longIdx) widths[i] = Math.max(FLOOR, (widths[i] / longTotal) * room);
  }
  const total = sum(widths);
  widths = widths.map((w) => (w / total) * USABLE); // fill the page exactly (grows when there is room, trims the last rounding)
  const cols: Col[] = r.headers.map((h, i) => ({ label: h, width: widths[i], align: numeric[i] ? "right" : "left" }));

  letterhead(doc, r.title.toUpperCase(), [["Rows", String(r.rows.length)]]);
  const line = [...scope, `Prepared ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`].join("  ·  ");
  doc.font("Helvetica").fontSize(9).fillColor("#5a6677").text(safe(line), 48, doc.y, { width: USABLE });
  doc.moveDown(0.8).fillColor("#16202c");

  if (body.length === 0) doc.fontSize(11).text("No records match these filters.", 48, doc.y);
  else table(doc, cols, body, { zebra: true, repeatHead: true });
  if (r.rows.length > MAX_ROWS) doc.moveDown(1).fontSize(9).fillColor("#b3261e").text(safe(`Showing the first ${MAX_ROWS} of ${r.rows.length} rows. Download the CSV for everything.`), 48, doc.y);
  return finish(doc);
}
