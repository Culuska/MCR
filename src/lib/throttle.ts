// Brute-force protection rules. Pure: give it the recent failed attempts and the time, get back whether to refuse.
// An account is never locked for good: the lock ends by itself, so no one is shut out without a way back.

export const WINDOW_MS = 15 * 60_000; // how far back failures count
export const MAX_FAILURES_PER_EMAIL = 5; // then that email is paused
export const MAX_FAILURES_PER_IP = 20; // then that address is paused, whatever emails it tries
export const RESET_REQUESTS_PER_HOUR_EMAIL = 3;
export const RESET_REQUESTS_PER_HOUR_IP = 10;

export type Verdict = { locked: false } | { locked: true; retryAfterSec: number };

/** `failures` are the times of failed attempts inside the window, in any order. */
export function lockout(failures: Date[], limit: number, now: Date, windowMs = WINDOW_MS): Verdict {
  const recent = failures.filter((d) => now.getTime() - d.getTime() < windowMs).sort((a, b) => b.getTime() - a.getTime());
  if (recent.length < limit) return { locked: false };
  // Paused until the failure that tipped it over ages out of the window: the limit-th most recent one.
  const until = recent[limit - 1].getTime() + windowMs;
  return { locked: true, retryAfterSec: Math.max(1, Math.ceil((until - now.getTime()) / 1000)) };
}

export const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));
