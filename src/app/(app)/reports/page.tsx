import { db } from "@/lib/db";
import { projectWhere, scopeOf } from "@/lib/scope";
import { requireRead } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";
import { PageHead } from "@/components/ui";
import { ReportRow } from "@/components/ReportRow";

export const metadata = { title: "Reports" };

export default async function Reports() {
  const user = await requireRead("reports");
  const scope = await scopeOf(user);
  const projects = await db.project.findMany({ where: projectWhere(scope), orderBy: { code: "asc" } });
  return (
    <>
      <PageHead title="Reports" sub="Preview each report as a PDF before you download it. CSV opens in Excel and Google Sheets." />
      {(["Financial", "Project", "Operations", "Stock"] as const).map((group) => (
        <section key={group} className="panel">
          <h2>{group} reports</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {REPORTS.filter((r) => r.group === group && (scope.all || r.scoped)).map((r) => (
              <ReportRow key={r.key} rep={{ key: r.key, title: r.title, filters: r.filters }} projects={projects.map((p) => ({ id: p.id, code: p.code }))} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
