import { banner, finish, heading, letterhead, newDoc, pairs, safe, signatures, table } from "../src/lib/pdf";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

async function main() {
  // Text the built-in fonts cannot draw becomes a question mark instead of garbage.
  eq("Arabic letters become ?", safe("مرحبا Hello"), "????? Hello");
  eq("accented Latin letters are kept", safe("Café Ñandú"), "Café Ñandú");
  eq("emoji become ?", safe("ok 👍"), "ok ??");
  eq("null and undefined become empty text", safe(null) + safe(undefined), "");
  eq("a script tag is just text in a PDF", safe("<script>alert(1)</script>"), "<script>alert(1)</script>");

  // A short document is a valid PDF with a header, a footer on page 1 of 1, and the right metadata.
  {
    const doc = newDoc("Invoice TEST-1");
    letterhead(doc, "INVOICE", [["Invoice no.", "TEST-1"], ["Status", "Sent"]]);
    heading(doc, "Bill to");
    pairs(doc, [["Name", "A customer"], ["Phone", "+252 61 000000"]]);
    table(doc, [{ label: "Item", width: 395 }, { label: "Amount", width: 100, align: "right" }], [["Works", "$1,000.00"]], { totals: ["Total", "$1,000.00"] });
    const b = await finish(doc);
    eq("it starts like a PDF", b.subarray(0, 5).toString(), "%PDF-");
    eq("it ends like a PDF", b.subarray(-6).toString().includes("%%EOF"), true);
    eq("a short document is one page", pages(b), 1);
    eq("the title is in the document information", b.toString("latin1").includes("Invoice TEST-1"), true);
    eq("it is not tiny", b.length > 1500, true);
  }

  // A long table runs onto more pages instead of running off the bottom or crashing.
  {
    const doc = newDoc("Long");
    letterhead(doc, "STATEMENT");
    table(doc, [{ label: "No.", width: 60 }, { label: "Description", width: 335 }, { label: "Amount", width: 100, align: "right" }],
      Array.from({ length: 160 }, (_, i) => [String(i + 1), `Line ${i + 1} of a long list`, `$${(i + 1) * 10}.00`]), { totals: ["", "Total", "$128,800.00"], zebra: true });
    const b = await finish(doc);
    eq("160 rows need several pages", pages(b) >= 4, true);
    eq("and still end properly", b.subarray(-6).toString().includes("%%EOF"), true);
  }

  // Awkward input does not break the page.
  {
    const doc = newDoc("Awkward");
    letterhead(doc, "TEST");
    banner(doc, "VOID. This invoice has been cancelled.");
    pairs(doc, [["Long value", "x".repeat(600)], ["Unbroken word", "W".repeat(300)], ["Arabic", "مرحبا بالعالم"]]);
    table(doc, [{ label: "A", width: 200 }, { label: "B", width: 295, align: "right" }], [["y".repeat(400), "z".repeat(400)], ["", ""]]);
    signatures(doc, ["Prepared by", "Approved by", "Subcontractor"]);
    const b = await finish(doc);
    eq("very long and non-Latin text still produces a PDF", b.subarray(0, 5).toString(), "%PDF-");
    eq("with a sensible number of pages", pages(b) <= 3, true);
  }

  // A signature block near the bottom of a page moves to the next page rather than being cut off.
  {
    const doc = newDoc("Signatures");
    letterhead(doc, "TEST");
    table(doc, [{ label: "N", width: 495 }], Array.from({ length: 38 }, (_, i) => [`row ${i}`]));
    signatures(doc, ["Prepared by", "Approved by"]);
    const b = await finish(doc);
    eq("the signature block never runs off the page", pages(b) >= 2, true);
  }

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
main();
