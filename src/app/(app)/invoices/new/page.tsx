import { redirect } from "next/navigation";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { PageHead } from "@/components/ui";
import { InvoiceForm } from "@/components/InvoiceForm";

export const metadata = { title: "New invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireRead("invoices");
  if (!canWrite(user.role, "invoices")) redirect("/invoices");
  const { project } = await searchParams;
  return (
    <>
      <PageHead title="New invoice" sub="Saved as a draft. Issue it when it is ready to send to the customer." />
      <InvoiceForm projectId={project} />
    </>
  );
}
