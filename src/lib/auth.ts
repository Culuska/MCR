import { createHmac } from "node:crypto";
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";
import { canRead, canWrite, type Module } from "@/lib/permissions";
import { ActionError } from "@/lib/errors";

const COOKIE = "mcr_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret() {
  // SESSION_SECRET, or on Vercel with Supabase attached, a key derived from Supabase's own secret (never used as is).
  const base = process.env.SUPABASE_JWT_SECRET ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const s = process.env.SESSION_SECRET ?? (base ? createHmac("sha256", base).update("mcr-session").digest("hex") : undefined);
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(userId: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export type SessionUser = { id: string; name: string; email: string; role: Role };

// Reads the cookie and re-checks the user in the database, so a deactivated user loses access at once.
export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let userId: string;
  try {
    userId = String((await jwtVerify(token, secret())).payload.sub);
  } catch {
    return null; // expired or tampered token: treat as signed out
  }
  // A database failure is not a sign-out. Let it surface instead of bouncing people to the login page.
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRead(m: Module): Promise<SessionUser> {
  const u = await requireUser();
  if (!canRead(u.role, m)) redirect("/?denied=" + m);
  return u;
}

// For server actions: throws a message the form can show instead of redirecting.
export async function requireWrite(m: Module): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new ActionError("Your session has expired. Sign in again.");
  if (!canWrite(u.role, m)) throw new ActionError("Your role does not allow this change.");
  return u;
}

