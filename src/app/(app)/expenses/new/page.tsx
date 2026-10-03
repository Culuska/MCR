import { redirect } from "next/navigation";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { PageHead } from "@/components/ui";
import { ExpenseForm } from "@/components/ExpenseForm";

export const metadata = { title: "New expense" };

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireRead("expenses");
  if (!canWrite(user.role, "expenses")) redirect("/expenses");
  const { project } = await searchParams;
  return (
    <>
      <PageHead title="New expense" sub="Saved as a draft. It does not affect the books until it is approved." />
      <ExpenseForm projectId={project} />
    </>
  );
}
