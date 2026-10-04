import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Extra queries wait for a free connection rather than opening more. The local `prisma dev` database
// drops connections once more than two are open at once, so it gets a pool of 2. Set DB_POOL_MAX to override.
function poolSize() {
  if (process.env.DB_POOL_MAX) return Number(process.env.DB_POOL_MAX);
  return /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? 2 : 10;
}

// Hosted databases (Supabase, Neon) need an encrypted connection; the local development one does not.
const hosted = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "");

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: hosted ? process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/, "") : process.env.DATABASE_URL, ssl: hosted ? { rejectUnauthorized: false } : undefined, max: poolSize(), idleTimeoutMillis: 10_000 }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
