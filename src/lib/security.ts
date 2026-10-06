import "server-only";
import { db } from "@/lib/db";
import { MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP, WINDOW_MS, lockout, type Verdict } from "@/lib/throttle";

// Sign-in protection backed by the LoginAttempt table. Counting is by email text, whether or not an account exists,
// so a locked message never reveals which emails are real.

export async function recordAttempt(a: { kind?: "login" | "reset"; email: string; ip: string | null; success: boolean; reason: string }) {
  await db.loginAttempt.create({ data: { kind: a.kind ?? "login", email: a.email, ip: a.ip, success: a.success, reason: a.reason } });
}

/** Is this email (or this address) currently paused for too many failed sign-ins? Failures before the last success do not count. */
export async function loginLock(email: string, ip: string | null, now = new Date()): Promise<Verdict> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const lastOk = await db.loginAttempt.findFirst({ where: { kind: "login", email, success: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const from = lastOk && lastOk.createdAt > since ? lastOk.createdAt : since;
  // Attempts refused during a pause (reason "locked") are not counted, so waiting is never made longer by trying again.
  const failed = { kind: "login", success: false, reason: { not: "locked" }, createdAt: { gt: from } } as const;
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.findMany({ where: { ...failed, email }, select: { createdAt: true } }),
    ip ? db.loginAttempt.findMany({ where: { kind: "login", success: false, reason: { not: "locked" }, ip, createdAt: { gt: since } }, select: { createdAt: true } }) : Promise.resolve([]),
  ]);
  const a = lockout(byEmail.map((r) => r.createdAt), MAX_FAILURES_PER_EMAIL, now);
  const b = lockout(byIp.map((r) => r.createdAt), MAX_FAILURES_PER_IP, now);
  if (a.locked && b.locked) return a.retryAfterSec >= b.retryAfterSec ? a : b;
  return a.locked ? a : b;
}

/** Reset-email requests in the last hour for this email and this address, to stop mail flooding. */
export async function resetRequestCounts(email: string, ip: string | null, now = new Date()) {
  const since = new Date(now.getTime() - 3_600_000);
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { kind: "reset", email, createdAt: { gte: since } } }),
    ip ? db.loginAttempt.count({ where: { kind: "reset", ip, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  return { byEmail, byIp };
}
