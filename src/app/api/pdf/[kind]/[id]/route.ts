import { getUser, type SessionUser } from "@/lib/auth";
import { canSeeInvoice, canSeeProject, canSeeRecord, scopeOf } from "@/lib/scope";
import { canRead, type Module } from "@/lib/permissions";
import { DocumentError, certificatePdf, invoicePdf, payslipsPdf, projectStatementPdf, type Pdf } from "@/lib/documents";

// One endpoint for every PDF. Each kind is gated by the module its data comes from, so a payslip needs payroll access,
// an invoice needs invoice access, and so on. A person without access gets a plain refusal, never the document.
type Kind = { module: Module; build: (id: string) => Promise<Pdf | null>; visible: (u: SessionUser, id: string) => Promise<boolean> };
const KINDS: Record<string, Kind> = {
  invoice: { module: "invoices", build: invoicePdf, visible: canSeeInvoice },
  project: { module: "projects", build: projectStatementPdf, visible: (u, id) => canSeeProject(u, id) },
  payroll: { module: "payroll", build: payslipsPdf, visible: async (u) => (await scopeOf(u)).all }, // payslips are company-wide
  certificate: { module: "subcontracts", build: certificatePdf, visible: (u, id) => canSeeRecord(u, "subCertificate", id) },
};

const text = (message: string, status: number) => new Response(message, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getUser();
  if (!user) return text("Sign in first.", 401);

  const { kind, id } = await params;
  const k = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
  if (!k) return text("Unknown document.", 404);
  if (!canRead(user.role, k.module)) return text("Your role cannot open this document.", 403);

  if (!(await k.visible(user, id))) return text("Not found.", 404); // a project you cannot see looks like one that does not exist
  try {
    const pdf = await k.build(id);
    if (!pdf) return text("Not found.", 404);
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.bytes.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdf.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof DocumentError) return text(e.message, e.status);
    console.error(e);
    return text("The document could not be made.", 500);
  }
}
