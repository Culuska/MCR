import Link from "next/link";
import { scopeOf } from "@/lib/scope";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { allProjectsSummary } from "@/lib/finance";
import { fmt, fmtDate } from "@/lib/money";
import { Bar, Empty, PageHead, Pill, Sample, clean } from "@/components/ui";

export const metadata = { title: "Projects" };

export default async function Projects() {
  const user = await requireRead("projects");
  const rows = await allProjectsSummary(await scopeOf(user));
  const order = ["ACTIVE", "PLANNING", "ON_HOLD", "COMPLETED", "CANCELLED"];
  rows.sort((a, b) => order.indexOf(a.project.status) - order.indexOf(b.project.status));
  return (
    <>
      <PageHead title="Projects" sub="Contract value, spending against budget, and expected profit">
        {canWrite(user.role, "projects") && <Link className="btn primary" href="/projects/new">New project</Link>}
      </PageHead>
      {rows.length === 0 ? (
        <Empty title="No projects yet">Create the first project to start tracking costs against a budget.</Empty>
      ) : (
        <section className="panel">
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th><th>Customer</th><th>Status</th><th>Finish</th>
                  <th className="r">Contract</th><th className="r">Cost to date</th>
                  <th style={{ width: 150 }}>Budget used</th><th className="r">Expected profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.project.id} className="link">
                    <td>
                      <Link href={`/projects/${r.project.id}`}><b>{r.project.code}</b></Link> <Sample name={r.project.name} />
                      <br /><span className="small muted">{clean(r.project.name)}</span>
                    </td>
                    <td>{r.project.customer ? clean(r.project.customer.name) : <span className="muted">—</span>}</td>
                    <td><Pill status={r.project.status} /></td>
                    <td className="num">{fmtDate(r.project.expectedEnd)}</td>
                    <td className="r num">{fmt(r.contract)}</td>
                    <td className="r num">{fmt(r.cost)}</td>
                    <td><Bar used={r.budgetUsed} /><span className="small muted num">{Math.round(r.budgetUsed)}%</span></td>
                    <td className={`r num ${r.expectedProfit.isNegative() ? "out" : ""}`}>{fmt(r.expectedProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
