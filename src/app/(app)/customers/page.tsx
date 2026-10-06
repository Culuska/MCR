import Link from "next/link";
import { onProject, projectWhere, scopeOf } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { D, fmt, sum } from "@/lib/money";
import { Empty, PageHead, Sample, clean } from "@/components/ui";
import { PartyForm } from "@/components/PartyForm";
import { saveCustomer } from "@/actions/projects";

export const metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await requireRead("customers");
  const { edit } = await searchParams;
  const writer = canWrite(user.role, "customers");
  const scope = await scopeOf(user);
  const customers = await db.customer.findMany({
    orderBy: { name: "asc" },
    include: { projects: { where: projectWhere(scope) }, invoices: { where: { status: { not: "VOID" }, ...onProject(scope) }, include: { payments: { where: { voided: false } } } } },
  });
  const editing = edit ? customers.find((c) => c.id === edit) : undefined;

  return (
    <>
      <PageHead title="Customers" sub="Who we build for, what they have been billed, and what they still owe" />
      {writer && (
        <details className="more" open={!!editing}>
          <summary>{editing ? `Edit ${clean(editing.name)}` : "Add a customer"}</summary>
          <div className="body"><PartyForm key={editing?.id ?? "new"} kind="customer" action={saveCustomer} party={editing} goTo="/customers" /></div>
        </details>
      )}
      {customers.length === 0 ? <Empty title="No customers yet">Add the clients you invoice, then link them to projects.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Customer</th><th>Type</th><th>Contact</th><th className="r">Projects</th><th className="r">Billed</th><th className="r">Outstanding</th><th /></tr></thead>
          <tbody>{customers.map((c) => {
            const billed = sum(c.invoices.filter((i) => i.status !== "DRAFT").map((i) => i.amount));
            const owed = sum(c.invoices.filter((i) => i.status === "SENT" || i.status === "PARTIAL").map((i) => D(i.amount).minus(sum(i.payments.map((p) => p.amount)))));
            return (
              <tr key={c.id}>
                <td><b>{clean(c.name)}</b> <Sample name={c.name} /></td>
                <td>{c.type ?? "—"}</td>
                <td>{c.contact ?? "—"}{c.phone && <><br /><span className="small muted">{c.phone}</span></>}</td>
                <td className="r num">{c.projects.length}</td>
                <td className="r num">{fmt(billed)}</td>
                <td className={`r num ${owed.greaterThan(0) ? "out" : ""}`}>{owed.greaterThan(0) ? fmt(owed) : "—"}</td>
                <td>{writer && <div className="row"><Link className="small" href={`/customers?edit=${c.id}`}>Edit</Link><DeleteButton kind="customer" id={c.id} name={clean(c.name)} /></div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div></section>
      )}
    </>
  );
}
