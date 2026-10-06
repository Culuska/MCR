import type { Role } from "@/generated/prisma/enums";

// Which projects a person may see. Pure, so the same rules are used by the app and by the checks.
//   Default: Project Managers and Site Supervisors see only the projects assigned to them (and ones they manage);
//   everyone else sees every project. An administrator can override this per person.
//   A Super Admin always sees everything, so the company can never be locked out of its own projects.

export const ASSIGNED_BY_DEFAULT: Role[] = ["PROJECT_MANAGER", "SITE_SUPERVISOR"];
export type ScopeSetting = "DEFAULT" | "ALL" | "ASSIGNED";
export type Scope = { all: true } | { all: false; ids: string[] };

export function seesAll(role: Role, setting: ScopeSetting): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (setting === "ALL") return true;
  if (setting === "ASSIGNED") return false;
  return !ASSIGNED_BY_DEFAULT.includes(role);
}

export const makeScope = (role: Role, setting: ScopeSetting, ids: string[]): Scope => (seesAll(role, setting) ? { all: true } : { all: false, ids: [...new Set(ids)] });

/** May this scope see a record on `projectId`? A record with no project belongs to the company, not to any project. */
export const allows = (scope: Scope, projectId: string | null | undefined): boolean => scope.all || (!!projectId && scope.ids.includes(projectId));

/** The ids a scoped person may see, or null when they may see everything. */
export const idsOf = (scope: Scope): string[] | null => (scope.all ? null : scope.ids);

export const SCOPE_LABEL: Record<ScopeSetting, string> = { DEFAULT: "Role default", ALL: "All projects", ASSIGNED: "Assigned projects only" };
