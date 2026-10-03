import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { ENTITIES, isEntity } from "@/lib/attachments";
import { getFile } from "@/lib/storage";

// Every download is checked: signed in, and allowed to read the record the file is attached to.
// Anything that does not pass looks like "not found", so a stranger cannot learn which files exist.
const notFound = () => new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Sign in first.", { status: 401, headers: { "Cache-Control": "no-store" } });

  const { id } = await params;
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || a.removed || !isEntity(a.entity) || !canRead(user.role, ENTITIES[a.entity].module)) return notFound();

  let bytes: Buffer;
  try { bytes = await getFile(a.storageKey); } catch { return notFound(); }

  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "X-Content-Type-Options": "nosniff", // the browser must believe the type we send
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", // a file can never run script
      "Cache-Control": "private, no-store",
    },
  });
}
