import PDFDocument from "pdfkit";

// A small layer over pdfkit so every document looks the same: company header, tables that break across pages, page footers.

export const COMPANY = "Mogadishu Construction and Rehabilitation";
const INK = "#16202c", MUTED = "#5a6677", LINE = "#d9dfe7", ACCENT = "#1c5db0", SOFT = "#f2f5f9";
const M = 48; // page margin

// The built-in PDF fonts cover Western European text. Anything else would print as junk, so show a ? instead.
export const safe = (s: unknown) => String(s ?? "").replace(/[^\x20-\x7E -ÿ]/g, "?");

export type Doc = InstanceType<typeof PDFDocument>;
export type Col = { label: string; width: number; align?: "left" | "right" };

export function newDoc(title: string, opts: { landscape?: boolean } = {}): Doc {
  return new PDFDocument({ size: "A4", layout: opts.landscape ? "landscape" : "portrait", margin: M, bufferPages: true, info: { Title: safe(title), Author: "MCR Finance", Producer: "MCR Finance", Creator: "MCR Finance" } });
}

export function finish(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // Footer on every page, written last so the page count is known.
    const range = doc.bufferedPageRange();
    const stamp = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 36;
      // The footer sits in the bottom margin. Writing there would make the library start a new page, so lift the margin first.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.save().fontSize(8).fillColor(MUTED);
      doc.text(`${COMPANY} · generated ${stamp}`, M, y, { lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, M, y, { width: doc.page.width - 2 * M, align: "right", lineBreak: false });
      doc.restore();
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

export function letterhead(doc: Doc, title: string, right?: [string, string][]) {
  const w = doc.page.width - 2 * M;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(safe(COMPANY.toUpperCase()), M, M, { width: w * 0.6 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Finance and project costing", M, doc.y + 1, { width: w * 0.6 });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(ACCENT).text(safe(title), M, M, { width: w, align: "right" });
  let y = M + 30;
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  for (const [k, v] of right ?? []) {
    doc.fillColor(MUTED).text(safe(k), M + w * 0.55, y, { width: w * 0.2, align: "right", lineBreak: false });
    doc.fillColor(INK).font("Helvetica-Bold").text(safe(v), M + w * 0.77, y, { width: w * 0.23, align: "right", lineBreak: false });
    doc.font("Helvetica");
    y += 13;
  }
  const bottom = Math.max(doc.y, y) + 8;
  doc.moveTo(M, bottom).lineTo(M + w, bottom).lineWidth(1.5).strokeColor(ACCENT).stroke();
  doc.y = bottom + 14;
  doc.x = M;
}

export function heading(doc: Doc, text: string) {
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(safe(text.toUpperCase()), M, doc.y, { characterSpacing: 0.6 });
  doc.moveDown(0.25).font("Helvetica").fontSize(10).fillColor(INK);
}

export function banner(doc: Doc, text: string, colour = "#b3261e") {
  const w = doc.page.width - 2 * M;
  const y = doc.y;
  doc.roundedRect(M, y, w, 24, 4).fill(colour);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(safe(text), M, y + 7, { width: w, align: "center" });
  doc.y = y + 34;
  doc.fillColor(INK).font("Helvetica");
}

// Label on the left, value on the right, one per line.
export function pairs(doc: Doc, rows: [string, string][], opts: { labelWidth?: number } = {}) {
  const lw = opts.labelWidth ?? 150;
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(safe(k), M, y, { width: lw, lineBreak: false });
    doc.fillColor(INK).text(safe(v), M + lw, y, { width: doc.page.width - 2 * M - lw });
    doc.y = Math.max(doc.y, y + 14);
  }
  doc.x = M;
}

export function table(doc: Doc, cols: Col[], rows: string[][], opts: { totals?: string[]; zebra?: boolean; repeatHead?: boolean } = {}) {
  const left = M;
  // A header that does not fit on one line wraps onto a second one, so long column names are never cut off.
  doc.font("Helvetica-Bold").fontSize(8);
  const headH = cols.some((c) => doc.widthOfString(c.label.toUpperCase()) > c.width - 10) ? 30 : 20;
  const draw = (cells: string[], o: { head?: boolean; total?: boolean; shade?: boolean }) => {
    const h = o.head ? headH : 18;
    if (doc.y + h > doc.page.height - 64) { doc.addPage(); doc.y = M; if (opts.repeatHead && !o.head) draw(cols.map((c) => c.label), { head: true }); }
    const y = doc.y;
    if (o.head) doc.rect(left, y, cols.reduce((a, c) => a + c.width, 0), h).fill(SOFT);
    else if (o.shade) doc.rect(left, y, cols.reduce((a, c) => a + c.width, 0), h).fill("#fafbfd");
    doc.fillColor(o.head ? MUTED : INK).font(o.head || o.total ? "Helvetica-Bold" : "Helvetica").fontSize(o.head ? 8 : 9.5);
    let x = left;
    cols.forEach((c, i) => {
      if (o.head) doc.text(safe(cells[i].toUpperCase()), x + 5, y + (headH > 20 ? 5 : 6), { width: c.width - 10, height: headH - 8, align: c.align ?? "left", lineGap: -1 });
      else doc.text(safe(cells[i]), x + 5, y + 5, { width: c.width - 10, height: 12, align: c.align ?? "left", lineBreak: false, ellipsis: true });
      x += c.width;
    });
    if (!o.head) doc.moveTo(left, y + h).lineTo(left + cols.reduce((a, c) => a + c.width, 0), y + h).lineWidth(0.5).strokeColor(o.total ? INK : LINE).stroke();
    doc.y = y + h;
  };
  draw(cols.map((c) => c.label), { head: true });
  rows.forEach((r, i) => draw(r, { shade: !!opts.zebra && i % 2 === 1 }));
  if (opts.totals) draw(opts.totals, { total: true });
  doc.x = M;
}

export function signatures(doc: Doc, labels: string[]) {
  if (doc.y + 70 > doc.page.height - 64) { doc.addPage(); doc.y = M; }
  doc.moveDown(2);
  const w = (doc.page.width - 2 * M) / labels.length;
  const y = doc.y + 24;
  labels.forEach((l, i) => {
    const x = M + i * w;
    doc.moveTo(x, y).lineTo(x + w - 24, y).lineWidth(0.7).strokeColor(MUTED).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(safe(l), x, y + 4, { width: w - 24, lineBreak: false });
  });
  doc.y = y + 24;
  doc.x = M;
}
