import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

// Sets the password of one user, or creates them as a Super Admin if the email is new. Lists the users that exist.
// Needs ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in the environment. ADMIN_NAME is used when creating.

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(), password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters).");
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) await db.user.update({ where: { email }, data: { passwordHash, active: true, role: "SUPER_ADMIN" } });
  else await db.user.create({ data: { email, name: process.env.ADMIN_NAME?.trim() || "Admin", role: "SUPER_ADMIN", passwordHash } });
  console.log(existing ? `Password updated for ${email}.` : `Admin created: ${email}.`);
  console.log("Users now:", (await db.user.findMany({ select: { email: true, role: true, active: true } })).map((u) => `${u.email} (${u.role}${u.active ? "" : ", off"})`).join(", "));
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
