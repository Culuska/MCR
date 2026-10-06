import Link from "next/link";
import { onProject, scopeOf } from "@/lib/scope";
import { DeleteButton } from "@/components/DeleteButton";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { D, fmt, sum } from "@/lib/money";
import { subcontractFigures } from "@/lib/finance";
import { Empty, PageHead } from "@/components/ui";
import { PartyForm } from "@/components/PartyForm";
import { saveSupplier } from "@/actions/projects";

export const metadata = { title: "Suppliers" };

export default async function Suppliers({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await requireRead("suppliers");
  const { edit } = await searchParams;
  const writer = canWrite(user.role, "suppliers");
  const scope = await scopeOf(user);
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    include: { expenses: { where: { status: { in: ["APPROVED", "PAID"] }, ...onProject(scope) }, include: { payments: { where: { voided: false } } } } },
  });
  const subs = await subcontractFigures(undefined, scope);
  const subOwed = (id: string) => sum(subs.filter((x) => x.sub.supplierId === id).map((x) => x.unpaid));
  const retention = (id: string) => sum(subs.filter((x) => x.sub.supplierId === id).map((x) => x.retentionHeld));
  const editing = edit ? suppliers.find((s) => s.id === edit) : undefined;

  return (
    <>
      <PageHead title="Suppliers" sub="Who we buy from, what we have spent, and what we still owe them" />
      {writer && (
        <details className="more" open={!!editing}>
          <summary>{editing ? `Edit ${editing.name}` : "Add a supplier"}</summary>
          <div className="body"><PartyForm key={editing?.id ?? "new"} kind="supplier" action={saveSupplier} party={editing} goTo="/suppliers" /></div>
        </details>
      )}
      {suppliers.length === 0 ? <Empty title="No suppliers yet">Add the suppliers you buy from so expenses can be traced to them.</Empty> : (
        <section className="panel"><div className="tablewrap"><table>
          <thead><tr><th>Supplier</th><th>Contact</th><th>Terms</th><th className="r">Spent</th><th className="r">We owe</th><th className="r">Retention held</th><th /></tr></thead>
          <tbody>{suppliers.map((s) => {
            const spent = sum(s.expenses.map((e) => e.amount)).plus(sum(subs.filter((x) => x.sub.supplierId === s.id).map((x) => x.certified)));
            const owed = sum(s.expenses.filter((e) => e.status === "APPROVED").map((e) => D(e.amount).minus(sum(e.payments.map((p) => p.amount))))).plus(subOwed(s.id));
            const held = retention(s.id);
            return (
              <tr key={s.id}>
                <td><b>{s.name}</b></td>
                <td>{s.contact ?? "—"}{s.phone && <><br /><span className="small muted">{s.phone}</span></>}</td>
                <td>{s.paymentTerms ?? "—"}</td>
                <td className="r num">{fmt(spent)}</td>
                <td className={`r num ${owed.greaterThan(0) ? "out" : ""}`}>{owed.greaterThan(0) ? fmt(owed) : "—"}</td>
                <td className="r num">{held.greaterThan(0) ? fmt(held) : "—"}</td>
                <td>{writer && <div className="row"><Link className="small" href={`/suppliers?edit=${s.id}`}>Edit</Link><DeleteButton kind="supplier" id={s.id} name={s.name} /></div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div></section>
      )}
    </>
  );
}
