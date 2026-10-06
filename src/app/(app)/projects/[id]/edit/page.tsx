import { notFound, redirect } from "next/navigation";
import { requireProject } from "@/lib/scope";
import { db } from "@/lib/db";
import { requireRead } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { PageHead } from "@/components/ui";
import { ProjectForm } from "@/components/ProjectForm";

export default async function EditProject({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRead("projects");
  const { id } = await params;
  if (!canWrite(user.role, "projects")) redirect(`/projects/${id}`);
  await requireProject(user, id);
  const project = await db.project.findUnique({ where: { id }, include: { budget: true } });
  if (!project) notFound();
  return (
    <>
      <PageHead title={`Edit ${project.code}`} sub="Changes to the contract value, budget and status are recorded in the audit trail." />
      <ProjectForm project={project} />
    </>
  );
}
