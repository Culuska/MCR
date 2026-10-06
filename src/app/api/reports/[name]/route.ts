import { getUser } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { db } from "@/lib/db";
import { REPORTS, buildReport, toCsv } from "@/lib/reports";
import { reportPdf } from "@/lib/report-pdf";
import { balanceSheet, parseDay, todayDay } from "@/lib/balance-sheet";
import { balanceSheetPdf } from "@/lib/balance-sheet-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!canRead(user.role, "reports")) return new Response("Your role cannot open reports.", { status: 403 });

  const { name } = await params;
  const q = new URL(req.url).searchParams;
  const parse = (v: string | null, end = false) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const d = new Date(v + (end ? "T23:59:59.999Z" : "T00:00:00.000Z"));
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const report = await buildReport(name, { from: parse(q.get("from")), to: parse(q.get("to"), true), projectId: q.get("project") || undefined, compare: parseDay(q.get("compare")) });
  if (!report) return new Response("Unknown report.", { status: 404 });

  const stamp = new Date().toISOString().slice(0, 10);

  // ?format=pdf shows the report as a PDF (inline, so the page can preview it); add &download=1 to save it.
  if (q.get("format") === "pdf") {
    const from = parse(q.get("from")), to = parse(q.get("to"), true);
    const project = q.get("project") ? await db.project.findUnique({ where: { id: q.get("project")! }, select: { code: true, name: true } }) : null;
    const filters = REPORTS.find((x) => x.key === name)?.filters ?? [];
    const scope: string[] = [];
    if (filters.includes("date")) scope.push(from || to ? `Period: ${from ? q.get("from") : "start"} to ${to ? q.get("to") : "today"}` : "All dates");
    if (filters.includes("project")) scope.push(project ? `Project: ${project.code} ${project.name.replace(" (sample)", "")}` : "All projects");
    // The balance sheet has its own layout (grouped accounts with totals); every other report is a table.
    const bytes = name === "balance-sheet" ? await balanceSheetPdf(await balanceSheet([parseDay(q.get("to")) ?? todayDay(), ...(parseDay(q.get("compare")) ? [parseDay(q.get("compare"))!] : [])])) : await reportPdf(report, scope);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${q.get("download") === "1" ? "attachment" : "inline"}; filename="mcr-${name}-${stamp}.pdf"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new Response(toCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mcr-${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
