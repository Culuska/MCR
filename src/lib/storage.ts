import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { KEY_PATTERN } from "@/lib/files";
import { db } from "@/lib/db";

// Where uploaded files live: a folder (STORAGE_DIR, default ./storage), or the database when STORAGE_DRIVER=db (use this on hosts with no persistent disk).
// Everything goes through these two functions, so moving to cloud storage later means replacing this file only.

const useDb = () => process.env.STORAGE_DRIVER === "db";
const root = () => path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"));

export async function putFile(bytes: Uint8Array): Promise<string> {
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  if (useDb()) {
    await db.storedFile.create({ data: { key, bytes: Buffer.from(bytes) } });
    return key;
  }
  const target = path.join(root(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" }); // wx: never overwrite an existing file
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  // The key comes from our own database, but check it anyway: a bad key must never become a path outside the folder.
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
  if (useDb()) {
    const f = await db.storedFile.findUnique({ where: { key } });
    if (!f) throw new Error("File not found.");
    return Buffer.from(f.bytes);
  }
  const target = path.resolve(root(), key);
  if (!target.startsWith(root() + path.sep)) throw new Error("Invalid storage key.");
  return readFile(target);
}
