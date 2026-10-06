import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

// Helpers for scripts/test_security.py. The test user is zz-sec@mcr.example and everything here touches only that user.
//   create    makes the user with password $SEC_PASSWORD
//   unlock    clears the sign-in attempts so lockout can be tested again
//   expire    makes every unused reset link for the user expired
//   state     prints counts the test needs
//   cleanup   removes the user and everything about them
const EMAIL = "zz-sec@mcr.example";

async function main() {
  const mode = process.argv[2];
  if (mode === "create") {
    const password = process.env.SEC_PASSWORD;
    if (!password) throw new Error("Set SEC_PASSWORD");
    await db.user.upsert({ where: { email: EMAIL }, create: { email: EMAIL, name: "Security Test", role: "VIEWER", passwordHash: await bcrypt.hash(password, 10) }, update: { passwordHash: await bcrypt.hash(password, 10), active: true } });
    console.log("created");
  } else if (mode === "unlock") {
    await db.loginAttempt.deleteMany({ where: { email: { in: [EMAIL, "nobody-here@mcr.example"] } } });
    console.log("unlocked");
  } else if (mode === "expire") {
    const u = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const r = await db.passwordReset.updateMany({ where: { userId: u.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    console.log("expired", r.count);
  } else if (mode === "state") {
    const u = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    console.log(JSON.stringify({
      unusedResets: await db.passwordReset.count({ where: { userId: u.id, usedAt: null } }),
      allResets: await db.passwordReset.count({ where: { userId: u.id } }),
      unknownEmailResets: await db.passwordReset.count({ where: { user: { email: "nobody-here@mcr.example" } } }),
      attempts: await db.loginAttempt.count({ where: { email: EMAIL } }),
      audit: (await db.auditLog.findMany({ where: { OR: [{ userId: u.id }, { entityId: u.id }] }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((a) => a.action),
      hashLooksLikeBcrypt: u.passwordHash.startsWith("$2"),
    }));
  } else if (mode === "cleanup") {
    const u = await db.user.findUnique({ where: { email: EMAIL } });
    if (u) {
      await db.passwordReset.deleteMany({ where: { userId: u.id } });
      await db.auditLog.deleteMany({ where: { OR: [{ userId: u.id }, { entityId: u.id }, { entityId: EMAIL }] } });
      await db.user.delete({ where: { id: u.id } });
    }
    await db.loginAttempt.deleteMany({ where: { email: { in: [EMAIL, "nobody-here@mcr.example"] } } });
    await db.auditLog.deleteMany({ where: { entityId: "nobody-here@mcr.example" } });
    console.log("cleaned");
  } else console.log("use: create | unlock | expire | state | cleanup");
}
main().finally(() => db.$disconnect());
