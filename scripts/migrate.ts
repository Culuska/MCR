import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

// Applies prisma/migrations/*/migration.sql to a hosted database, in order, each once. Runs as part of the Vercel build.
// Skipped on a normal computer (use `prisma migrate deploy` there). Uses the same driver as the app.
if (!process.env.VERCEL && process.env.MIGRATE_ON_BUILD !== "1") { console.log("migrate: skipped (not a hosted build)"); process.exit(0); }
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) { console.error("migrate: neither DATABASE_URL nor POSTGRES_URL is set"); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: url!.split("?")[0], ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await c.connect();
  try {
    await c.query('create table if not exists "_mcr_migrations" (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query("select name from _mcr_migrations")).rows.map((r) => r.name));
    const dir = path.join(process.cwd(), "prisma", "migrations");
    for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      if (done.has(name)) continue;
      console.log("migrate: applying", name);
      await c.query("begin");
      try {
        await c.query(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
        await c.query("insert into _mcr_migrations (name) values ($1)", [name]);
        await c.query("commit");
      } catch (e) { await c.query("rollback"); throw e; }
    }
    console.log("migrate: database is up to date");
  } finally { await c.end(); }
}
main().catch((e) => { console.error("migrate failed:", e.code ?? "", e.message); process.exit(1); });
