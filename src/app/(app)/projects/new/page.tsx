import { redirect } from "next/navigation";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { PageHead } from "@/components/ui";
import { ProjectForm } from "@/components/ProjectForm";

export const metadata = { title: "New project" };

export default async function NewProject() {
  const user = await requireRead("projects");
  if (!canWrite(user.role, "projects")) redirect("/projects");
  return (
    <>
      <PageHead title="New project" sub="Contract, dates and the budget the spending will be measured against." />
      <ProjectForm />
    </>
  );
}
