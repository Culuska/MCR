import { createHash, randomBytes } from "node:crypto";

// Password reset links. The link carries a random token; the database keeps only its SHA-256 hash, so a leaked
// database cannot be used to reset anyone's password. A token works once and expires quickly.

export const RESET_MINUTES = 30;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const looksLikeToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t); // 32 random bytes, base64url

export type ResetState = "valid" | "used" | "expired" | "missing";
export function resetState(row: { usedAt: Date | null; expiresAt: Date } | null | undefined, now = new Date()): ResetState {
  if (!row) return "missing";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}
