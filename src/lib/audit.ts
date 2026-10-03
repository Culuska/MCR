import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";

type Entry = {
  userId?: string | null; action: string; entity: string; entityId: string; summary: string;
  before?: unknown; after?: unknown;
};

// Pass the open transaction so the audit row commits or rolls back with the change it describes.
export async function audit(e: Entry, tx?: Tx) {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      userId: e.userId ?? null, action: e.action, entity: e.entity, entityId: e.entityId, summary: e.summary,
      before: e.before === undefined ? undefined : JSON.parse(JSON.stringify(e.before)),
      after: e.after === undefined ? undefined : JSON.parse(JSON.stringify(e.after)),
    },
  });
}
