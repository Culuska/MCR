"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, createSession, destroySession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/request";
import { loginLock, recordAttempt } from "@/lib/security";
import { MAX_FAILURES_PER_EMAIL, minutes } from "@/lib/throttle";
import { formObject, type FormState } from "@/lib/action";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter your email address."), password: z.string().min(1, "Enter your password.").max(200) });

// Checked against when the email is unknown, so a wrong email takes as long as a wrong password and reveals nothing.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-account", 12);
const WRONG = "Email or password is not correct.";

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password } = parsed.data;
  const ip = await clientIp();

  const lock = await loginLock(email, ip);
  if (lock.locked) {
    await recordAttempt({ email, ip, success: false, reason: "locked" });
    return { error: `Too many sign-in attempts. Wait ${minutes(lock.retryAfterSec)} minute${minutes(lock.retryAfterSec) === 1 ? "" : "s"} and try again.` };
  }

  const user = await db.user.findUnique({ where: { email } });
  const passwordOk = await checkPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !passwordOk) {
    await recordAttempt({ email, ip, success: false, reason: !user ? "unknown-email" : !user.active ? "inactive" : "bad-password" });
    // The attempt that tips the account into a pause is written to the audit trail, so repeated guessing is visible.
    const after = await loginLock(email, ip);
    if (after.locked && !lock.locked) {
      await audit({ userId: user?.id ?? null, action: "auth.lockout", entity: "User", entityId: user?.id ?? email, ip,
        summary: `Sign-in paused for ${email} after ${MAX_FAILURES_PER_EMAIL} failed attempts${ip ? ` (from ${ip})` : ""}` });
    }
    // Same message whatever went wrong, so the form cannot be used to find out which emails have accounts.
    return { error: WRONG };
  }

  await recordAttempt({ email, ip, success: true, reason: "ok" });
  await createSession(user.id);
  await audit({ userId: user.id, action: "auth.login", entity: "User", entityId: user.id, summary: `${user.name} signed in`, ip });
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
