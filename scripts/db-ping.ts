import { Client } from "pg";

// Connects with the same driver the app uses and prints whether it worked. Never prints the password.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL first.");
const c = new Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
c.connect()
  .then(() => c.query("select current_database() as db, count(*)::int as tables from information_schema.tables where table_schema = 'public'"))
  .then((r) => console.log("connected:", JSON.stringify(r.rows[0])))
  .catch((e) => console.log("failed:", e.code ?? "", e.message))
  .finally(() => c.end().catch(() => {}));
