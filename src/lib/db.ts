import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// DATABASE_URL, or the connection Vercel adds when a Supabase database is attached to the project.
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Extra queries wait for a free connection rather than opening more. The local `prisma dev` database
// drops connections once more than two are open at once, so it gets a pool of 2. Set DB_POOL_MAX to override.
function poolSize() {
  if (process.env.DB_POOL_MAX) return Number(process.env.DB_POOL_MAX);
  if (process.env.VERCEL) return 3; // many short-lived server instances share one hosted database
  return /localhost|127\.0\.0\.1/.test(url ?? "") ? 2 : 10;
}

// Hosted databases (Supabase, Neon) need an encrypted connection; the local development one does not.
const hosted = !/localhost|127\.0\.0\.1/.test(url ?? "");

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: hosted ? url?.split("?")[0] : url, ssl: hosted ? { rejectUnauthorized: false } : undefined, max: poolSize(), idleTimeoutMillis: 10_000 }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
