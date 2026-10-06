import { passwordProblems } from "../src/lib/password-policy";
import { lockout, MAX_FAILURES_PER_EMAIL, WINDOW_MS } from "../src/lib/throttle";
import { hashToken, looksLikeToken, newToken, resetState } from "../src/lib/reset-token";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : `got ${got}, want ${want}`);
};
const has = (pw: string, text: string, who = {}) => passwordProblems(pw, who).some((p) => p.includes(text));
const ok = (pw: string, who = {}) => passwordProblems(pw, who).length === 0;

// ---- passwords ----
eq("a strong password is accepted", ok("Tr0ub4dor&Horse-Battery"), true);
eq("11 characters is too short", has("Abcdef1!ghi", "at least 12"), true);
eq("12 characters is long enough", has("Abcdef1!ghij", "at least 12"), false);
eq("needs a lowercase letter", has("ABCDEFGH1234!!", "lowercase"), true);
eq("needs an uppercase letter", has("abcdefgh1234!!", "uppercase"), true);
eq("needs a number", has("Abcdefgh-ijkl!!", "number"), true);
eq("needs a symbol", has("Abcdefgh12345678", "symbol"), true);
eq("the email address is refused", has("osman@mcr.com", "email", { email: "osman@mcr.com" }), true);
eq("the part before the @ is refused", has("Osman-2026-Strong!", "email", { email: "osman@mcr.com" }), true);
eq("the person's name is refused", has("Cusman#Builds-2026", "name", { name: "Cusman Hersi" }), true);
eq("short name pieces are not a problem", has("Xk9#vTq2-LmPz!", "name", { name: "Al Bo" }), false);
eq("a common password is refused", has("Password123!!", "common"), true);
eq("a common word with decoration is refused", has("Welcome-2026!!", "common"), true);
eq("a long unrelated passphrase containing a common word is allowed", has("correct-Horse-battery-Staple-9!", "common"), false);
eq("one repeated character is refused", has("aaaaaaaaaaaaaaaa", "repeat"), true);
eq("a very long password is refused", has("A1!" + "a".repeat(120), "at most"), true);
eq("problems are listed together", passwordProblems("abc").length >= 4, true);

// ---- lockout ----
const t0 = new Date("2026-10-06T10:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const fails = (mins: number[]) => mins.map(at);
eq("four failures do not lock", lockout(fails([0, 1, 2, 3]), MAX_FAILURES_PER_EMAIL, at(4)).locked, false);
const five = lockout(fails([0, 1, 2, 3, 4]), MAX_FAILURES_PER_EMAIL, at(5));
eq("five failures lock", five.locked, true);
eq("the pause lasts until the first of the five ages out (10 more minutes)", five.locked && five.retryAfterSec, 10 * 60);
eq("the pause ends by itself", lockout(fails([0, 1, 2, 3, 4]), MAX_FAILURES_PER_EMAIL, at(16)).locked, false);
eq("old failures outside the window are ignored", lockout(fails([0, 1, 2, 3, 4]), MAX_FAILURES_PER_EMAIL, at(0 + WINDOW_MS / 60_000 + 5)).locked, false);
eq("six failures wait for the 5th most recent to age out", lockout(fails([0, 1, 2, 3, 4, 5]), MAX_FAILURES_PER_EMAIL, at(6)).locked && (lockout(fails([0, 1, 2, 3, 4, 5]), MAX_FAILURES_PER_EMAIL, at(6)) as { retryAfterSec: number }).retryAfterSec, 10 * 60);
eq("no failures never lock", lockout([], MAX_FAILURES_PER_EMAIL, t0).locked, false);

// ---- reset tokens ----
const a = newToken(), b = newToken();
eq("tokens are 43 URL-safe characters (256 random bits)", looksLikeToken(a), true);
eq("two tokens differ", a === b, false);
eq("the stored value is not the token", hashToken(a) === a, false);
eq("the same token always hashes the same", hashToken(a) === hashToken(a), true);
eq("a different token hashes differently", hashToken(a) === hashToken(b), false);
eq("the hash is 64 hex characters", /^[0-9a-f]{64}$/.test(hashToken(a)), true);
eq("short or odd text is not a token", ["", "abc", "../../etc/passwd", a + "x", a.slice(1)].some(looksLikeToken), false);
const now = new Date();
eq("a fresh link is valid", resetState({ usedAt: null, expiresAt: new Date(now.getTime() + 60_000) }, now), "valid");
eq("an expired link is refused", resetState({ usedAt: null, expiresAt: new Date(now.getTime() - 1) }, now), "expired");
eq("a used link is refused", resetState({ usedAt: now, expiresAt: new Date(now.getTime() + 60_000) }, now), "used");
eq("an unknown link is refused", resetState(null, now), "missing");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
