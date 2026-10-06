import { ASSIGNED_BY_DEFAULT, allows, idsOf, makeScope, seesAll } from "../src/lib/scope-rules";
import { ROLE_LABEL } from "../src/lib/permissions";
import type { Role } from "../src/generated/prisma/enums";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};

const roles = Object.keys(ROLE_LABEL) as Role[];

// Role defaults.
eq("a Project Manager is limited to assigned projects by default", seesAll("PROJECT_MANAGER", "DEFAULT"), false);
eq("a Site Supervisor is limited by default", seesAll("SITE_SUPERVISOR", "DEFAULT"), false);
for (const r of roles.filter((r) => !ASSIGNED_BY_DEFAULT.includes(r))) eq(`${ROLE_LABEL[r]} sees every project by default`, seesAll(r, "DEFAULT"), true);

// Overrides.
eq("an administrator can give a Project Manager every project", seesAll("PROJECT_MANAGER", "ALL"), true);
eq("an administrator can limit a Viewer to some projects", seesAll("VIEWER", "ASSIGNED"), false);
eq("an administrator can limit Finance staff to some projects", seesAll("FINANCE_MANAGER", "ASSIGNED"), false);
eq("a Super Admin always sees everything, whatever is set", seesAll("SUPER_ADMIN", "ASSIGNED"), true);

// Scope objects.
const limited = makeScope("PROJECT_MANAGER", "DEFAULT", ["a", "b", "a"]);
eq("duplicate assignments count once", idsOf(limited)?.join(","), "a,b");
eq("an assigned project is allowed", allows(limited, "a"), true);
eq("another project is refused", allows(limited, "z"), false);
eq("a record with no project is refused for a limited person", allows(limited, null), false);
eq("undefined is refused too", allows(limited, undefined), false);
eq("an empty id is refused", allows(limited, ""), false);
eq("a limited person with no projects sees nothing", allows(makeScope("SITE_SUPERVISOR", "DEFAULT", []), "a"), false);
const everything = makeScope("FINANCE_MANAGER", "DEFAULT", []);
eq("full access allows any project", allows(everything, "z"), true);
eq("full access allows records with no project", allows(everything, null), true);
eq("full access has no id list", idsOf(everything), null);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
