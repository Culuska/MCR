// What a password must look like. Pure, so the same rules run in the sign-up form, the reset page and the checks.

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 100;

// A short list of the passwords attackers try first, plus words people build passwords from. Matching ignores case and symbols.
const COMMON = [
  "password", "passw0rd", "p@ssw0rd", "qwerty", "qwertyuiop", "letmein", "welcome", "admin", "administrator", "iloveyou", "monkey", "dragon", "football",
  "abc123", "changeme", "default", "secret", "master", "login", "trustno1", "sunshine", "princess", "whatever", "mogadishu", "somalia", "mcr", "construction",
  "company", "123456", "12345678", "123456789", "1234567890", "111111", "000000", "asdfgh", "zxcvbn",
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Everything wrong with a password, in plain words. An empty list means it is acceptable. */
export function passwordProblems(pw: string, who: { email?: string | null; name?: string | null } = {}): string[] {
  const out: string[] = [];
  if (pw.length < MIN_LENGTH) out.push(`Use at least ${MIN_LENGTH} characters.`);
  if (pw.length > MAX_LENGTH) out.push(`Use at most ${MAX_LENGTH} characters.`);
  if (!/[a-z]/.test(pw)) out.push("Add a lowercase letter.");
  if (!/[A-Z]/.test(pw)) out.push("Add an uppercase letter.");
  if (!/[0-9]/.test(pw)) out.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(pw)) out.push("Add a symbol such as ! ? # or -.");
  if (/^(.)\1+$/.test(pw)) out.push("Do not repeat one character.");

  const flat = squash(pw);
  const email = (who.email ?? "").toLowerCase();
  const local = squash(email.split("@")[0] ?? "");
  if (email && (pw.toLowerCase() === email || (local.length >= 4 && flat.includes(local)))) out.push("Do not use your email address in your password.");
  const names = (who.name ?? "").toLowerCase().split(/\s+/).map(squash).filter((n) => n.length >= 4);
  if (names.some((n) => flat.includes(n))) out.push("Do not use your name in your password.");
  if (COMMON.some((c) => flat === c || (c.length >= 6 && flat.includes(c) && flat.length <= c.length + 6))) out.push("That password is too common or easy to guess.");
  return out;
}

export const POLICY_TEXT = `At least ${MIN_LENGTH} characters with an uppercase letter, a lowercase letter, a number and a symbol. Not your email or name, and not a common password.`;
