"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, createSession, destroySession, hashPassword, requireWrite, requireUser } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { clientIp, appUrl } from "@/lib/request";
import { loginLock, recordAttempt, resetRequestCounts } from "@/lib/security";
import { RESET_REQUESTS_PER_HOUR_EMAIL, RESET_REQUESTS_PER_HOUR_IP, minutes } from "@/lib/throttle";
import { passwordProblems } from "@/lib/password-policy";
import { RESET_MINUTES, hashToken, looksLikeToken, newToken, resetState } from "@/lib/reset-token";
import { emailStatus, passwordChangedEmail, resetEmail, sendMail } from "@/lib/email";
import { formObject, run, type FormState } from "@/lib/action";

const GENERIC_REQUEST = `If that email belongs to an account, a password reset link is on its way. It expires in ${RESET_MINUTES} minutes. Check your spam folder too.`;
const BAD_LINK = "This reset link is not valid or has expired. Request a new one.";

// Makes a fresh single-use link for a user, cancelling any earlier ones, and emails it after the response is sent.
async function issueReset(user: { id: string; name: string; email: string }, ip: string | null): Promise<"sent" | "no-email" | "no-url"> {
  const token = newToken();
  await db.$transaction([
    db.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }), // older links stop working
    db.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000), requestedIp: ip } }),
  ]);
  const base = appUrl();
  if (!base) { console.warn("[reset] APP_URL is not set, so no reset email was sent"); return "no-url"; }
  const link = `${base}/reset-password/${token}`;
  const configured = emailStatus().configured;
  if (!configured && process.env.NODE_ENV !== "production") console.log(`[reset] email is not configured; development reset link for ${user.email}: ${link}`);
  after(async () => { const m = resetEmail(user.name, link, RESET_MINUTES); await sendMail({ ...m, to: user.email }); });
  return configured ? "sent" : "no-email";
}

// ---------- forgot password ----------

export async function requestReset(_: FormState, fd: FormData): Promise<FormState> {
  const email = z.string().trim().toLowerCase().email().safeParse(String(fd.get("email") ?? ""));
  if (!email.success) return { error: "Enter your email address." };
  const ip = await clientIp();

  // Same answer whether or not the email exists, and whether or not we are rate limiting, so nothing can be learned from it.
  const counts = await resetRequestCounts(email.data, ip);
  if (counts.byEmail >= RESET_REQUESTS_PER_HOUR_EMAIL || counts.byIp >= RESET_REQUESTS_PER_HOUR_IP) {
    await recordAttempt({ kind: "reset", email: email.data, ip, success: false, reason: "throttled" });
    return { ok: GENERIC_REQUEST };
  }
  const user = await db.user.findUnique({ where: { email: email.data } });
  await recordAttempt({ kind: "reset", email: email.data, ip, success: !!user?.active, reason: !user ? "unknown-email" : !user.active ? "inactive" : "requested" });
  if (user?.active) {
    const result = await issueReset(user, ip);
    await audit({ userId: user.id, action: "auth.reset_requested", entity: "User", entityId: user.id, ip,
      summary: `Password reset requested for ${user.email}${result === "sent" ? "" : result === "no-url" ? " (no email sent: APP_URL is not set)" : " (no email sent: email is not set up)"}` });
  }
  return { ok: GENERIC_REQUEST };
}

// ---------- choose a new password from the emailed link ----------

const resetSchema = z.object({ token: z.string(), password: z.string().max(200), confirm: z.string().max(200) });

export async function resetWithToken(_: FormState, fd: FormData): Promise<FormState> {
  const result = await run(async () => {
    const v = resetSchema.parse(formObject(fd));
    if (!looksLikeToken(v.token)) throw new ActionError(BAD_LINK);
    const row = await db.passwordReset.findUnique({ where: { tokenHash: hashToken(v.token) }, include: { user: true } });
    if (resetState(row) !== "valid" || !row!.user.active) throw new ActionError(BAD_LINK);
    const user = row!.user;

    if (v.password !== v.confirm) throw new ActionError("The two passwords do not match.");
    const problems = passwordProblems(v.password, user);
    if (problems.length) throw new ActionError(problems.join(" "));
    if (await checkPassword(v.password, user.passwordHash)) throw new ActionError("Choose a password you have not used on this account.");

    const ip = await clientIp();
    const hash = await hashPassword(v.password);
    await db.$transaction(async (tx) => {
      // The link is spent only if it is still unused, so two people cannot both use it.
      const spent = await tx.passwordReset.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } });
      if (spent.count !== 1) throw new ActionError(BAD_LINK);
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash, sessionsValidFrom: new Date() } });
      await tx.loginAttempt.create({ data: { kind: "login", email: user.email, ip, success: true, reason: "password-reset" } }); // ends any sign-in pause
      await audit({ userId: user.id, action: "auth.password_reset", entity: "User", entityId: user.id, ip, summary: `${user.name} chose a new password using a reset link` }, tx);
    });
    after(async () => { await sendMail({ ...passwordChangedEmail(user.name), to: user.email }); });
    return "done";
  });
  if (result?.ok) redirect("/login?reset=1");
  return result;
}

// ---------- change my password / sign out everywhere ----------

const changeSchema = z.object({ current: z.string().max(200), password: z.string().max(200), confirm: z.string().max(200) });

export async function changeOwnPassword(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const me = await requireUser();
    const v = changeSchema.parse(formObject(fd));
    const ip = await clientIp();
    const lock = await loginLock(me.email, ip);
    if (lock.locked) throw new ActionError(`Too many attempts. Wait ${minutes(lock.retryAfterSec)} minute(s) and try again.`);
    const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await checkPassword(v.current, user.passwordHash))) {
      await recordAttempt({ email: user.email, ip, success: false, reason: "bad-current-password" });
      throw new ActionError("Your current password is not correct.");
    }
    if (v.password !== v.confirm) throw new ActionError("The two new passwords do not match.");
    if (v.password === v.current) throw new ActionError("Choose a new password that is different from the current one.");
    const problems = passwordProblems(v.password, user);
    if (problems.length) throw new ActionError(problems.join(" "));

    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(v.password), sessionsValidFrom: new Date() } });
    await audit({ userId: user.id, action: "auth.password_changed", entity: "User", entityId: user.id, ip, summary: `${user.name} changed their password` });
    await createSession(user.id); // every other session is now ended; this one carries on
    after(async () => { await sendMail({ ...passwordChangedEmail(user.name), to: user.email }); });
    return "Password changed. Your other sessions have been signed out.";
  });
}

export async function signOutEverywhere() {
  const me = await requireUser();
  await db.user.update({ where: { id: me.id }, data: { sessionsValidFrom: new Date() } });
  await audit({ userId: me.id, action: "auth.signout_all", entity: "User", entityId: me.id, summary: `${me.name} signed out of all sessions` });
  await destroySession();
  redirect("/login");
}

// ---------- an administrator sends someone a reset link (they never see or choose the password) ----------

export async function sendResetLink(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const admin = await requireWrite("settings");
    const id = z.string().min(1).parse(fd.get("id"));
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (!user.active) throw new ActionError(`${user.name} is deactivated.`);
    if (!emailStatus().configured) throw new ActionError("Email is not set up yet (see Settings, Security). Set a temporary password instead.");
    if (!appUrl()) throw new ActionError("APP_URL is not set, so a safe link cannot be built (see Settings, Security).");
    await issueReset(user, await clientIp());
    await audit({ userId: admin.id, action: "user.reset_link", entity: "User", entityId: user.id, summary: `${admin.name} sent ${user.name} a password reset link` });
    revalidatePath("/settings");
    return `Reset link sent to ${user.email}. It expires in ${RESET_MINUTES} minutes.`;
  });
}
