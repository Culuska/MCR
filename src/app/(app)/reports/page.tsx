import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { REPORTS } from "@/lib/reports";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function Reports() {
  await requireRead("reports");
  const projects = await db.project.findMany({ orderBy: { code: "asc" } });
  return (
    <>
      <PageHead title="Reports" sub="Download as CSV. Excel and Google Sheets open these directly." />
      {(["Financial", "Project", "Operations", "Stock"] as const).map((group) => (
        <section key={group} className="panel">
          <h2>{group} reports</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {REPORTS.filter((r) => r.group === group).map((r) => (
              // A plain GET form: the browser downloads the file the API returns.
              <form key={r.key} action={`/api/reports/${r.key}`} method="get" className="filters" style={{ justifyContent: "space-between", paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
                <b style={{ minWidth: 200 }}>{r.title}</b>
                <div className="filters">
                  {r.filters?.includes("date") && (<>
                    <input type="date" name="from" aria-label={`${r.title} from date`} /><span className="muted">to</span><input type="date" name="to" aria-label={`${r.title} to date`} />
                  </>)}
                  {r.filters?.includes("project") && (
                    <select name="project" aria-label={`${r.title} project`}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
                  )}
                  <button type="submit" className="btn sm">Download CSV</button>
                </div>
              </form>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
