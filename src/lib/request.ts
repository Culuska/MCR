import "server-only";
import { headers } from "next/headers";

/** The address the request came from, as reported by the host (Vercel sets x-forwarded-for). Null outside a request. */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

/**
 * The public address of the app, used in emails. It comes from APP_URL, never from the request, so nobody can
 * make a reset email point at another website by sending a forged Host header. Null in production when APP_URL is not set.
 */
export function appUrl(): string | null {
  const set = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (set) return set;
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}
