"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { ROLE_LABEL } from "@/lib/permissions";
import { passwordProblems } from "@/lib/password-policy";
import { formObject, run, type FormState } from "@/lib/action";
import { Role } from "@/generated/prisma/enums";

const password = z.string().max(100, "Use at most 100 characters.");

async function adminOnly() {
  const user = await requireWrite("settings"); // only Super Admin holds write access to settings
  return user;
}

async function activeAdmins() {
  return db.user.count({ where: { role: "SUPER_ADMIN", active: true } });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(Role, { error: "Choose a role." }),
  password,
});

export async function createUser(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const admin = await adminOnly();
    const v = createSchema.parse(formObject(fd));
    const weak = passwordProblems(v.password, v);
    if (weak.length) throw new ActionError(weak.join(" "));
    if (await db.user.findUnique({ where: { email: v.email } })) throw new ActionError(`${v.email} already has an account.`);
    const u = await db.user.create({ data: { name: v.name, email: v.email, role: v.role, passwordHash: await hashPassword(v.password) } });
    await audit({ userId: admin.id, action: "user.create", entity: "User", entityId: u.id, summary: `${admin.name} added ${u.name} (${u.email}) as ${ROLE_LABEL[u.role]}` });
    revalidatePath("/settings");
    return `${u.name} added`;
  });
}

const updateSchema = z.object({ id: z.string(), role: z.enum(Role), active: z.enum(["on", "off"]) });

export async function updateUser(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const admin = await adminOnly();
    const v = updateSchema.parse(formObject(fd));
    const before = await db.user.findUniqueOrThrow({ where: { id: v.id } });
    const active = v.active === "on";
    // Never leave the company without a working Super Admin, and never let someone lock themselves out by accident.
    const losesAdmin = before.role === "SUPER_ADMIN" && before.active && (v.role !== "SUPER_ADMIN" || !active);
    if (losesAdmin && (await activeAdmins()) <= 1) throw new ActionError("This is the only active Super Admin. Make someone else a Super Admin first.");
    if (before.id === admin.id && !active) throw new ActionError("You cannot deactivate your own account.");

    await db.user.update({ where: { id: v.id }, data: { role: v.role, active } });
    const changes = [
      before.role !== v.role && `role ${ROLE_LABEL[before.role]} to ${ROLE_LABEL[v.role]}`,
      before.active !== active && (active ? "reactivated" : "deactivated"),
    ].filter(Boolean);
    if (changes.length) await audit({ userId: admin.id, action: "user.update", entity: "User", entityId: v.id, summary: `${admin.name} changed ${before.name}: ${changes.join(", ")}` });
    revalidatePath("/settings");
    return changes.length ? `${before.name} updated` : "No changes";
  });
}

export async function resetPassword(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const admin = await adminOnly();
    const v = z.object({ id: z.string(), password }).parse(formObject(fd));
    const u = await db.user.findUniqueOrThrow({ where: { id: v.id } });
    const weak = passwordProblems(v.password, u);
    if (weak.length) throw new ActionError(weak.join(" "));
    // Their other sessions end, so whoever held the old password is signed out.
    await db.user.update({ where: { id: v.id }, data: { passwordHash: await hashPassword(v.password), sessionsValidFrom: new Date() } });
    await audit({ userId: admin.id, action: "user.password", entity: "User", entityId: v.id, summary: `${admin.name} reset the password for ${u.name}` });
    return `Password reset for ${u.name}`;
  });
}
