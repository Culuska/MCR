import "dotenv/config";
import { SignJWT } from "jose";
import { db } from "../src/lib/db";

// Local testing only: signs a session for a seeded demo user so pages can be fetched without the login form.
async function main() {
  const email = process.argv[2] ?? "pm@mcr.example";
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuedAt().setExpirationTime("2h").sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  console.log(token);
}
main().finally(() => db.$disconnect());
