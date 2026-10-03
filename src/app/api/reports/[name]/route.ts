import { getUser } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { buildReport, toCsv } from "@/lib/reports";

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
  const report = await buildReport(name, { from: parse(q.get("from")), to: parse(q.get("to"), true), projectId: q.get("project") || undefined });
  if (!report) return new Response("Unknown report.", { status: 404 });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mcr-${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
