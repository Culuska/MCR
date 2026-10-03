"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, createSession, destroySession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { formObject, type FormState } from "@/lib/action";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter your email address."), password: z.string().min(1, "Enter your password.") });

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  // Same message for unknown email and wrong password, so the form does not reveal which accounts exist.
  const good = user && user.active && (await checkPassword(parsed.data.password, user.passwordHash));
  if (!user || !good) return { error: "Email or password is not correct." };
  await createSession(user.id);
  await audit({ userId: user.id, action: "auth.login", entity: "User", entityId: user.id, summary: `${user.name} signed in` });
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
