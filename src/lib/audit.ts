import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";

type Entry = {
  userId?: string | null; action: string; entity: string; entityId: string; summary: string;
  before?: unknown; after?: unknown; ip?: string | null;
};

// Pass the open transaction so the audit row commits or rolls back with the change it describes.
export async function audit(e: Entry, tx?: Tx) {
  const client = tx ?? db;
  // The address comes from the current request. Scripts have no request, so it stays empty there.
  let ip = e.ip ?? null;
  if (ip === null && e.ip === undefined) {
    try { ip = await (await import("@/lib/request")).clientIp(); } catch { ip = null; }
  }
  await client.auditLog.create({
    data: {
      ip,
      userId: e.userId ?? null, action: e.action, entity: e.entity, entityId: e.entityId, summary: e.summary,
      before: e.before === undefined ? undefined : JSON.parse(JSON.stringify(e.before)),
      after: e.after === undefined ? undefined : JSON.parse(JSON.stringify(e.after)),
    },
  });
}
