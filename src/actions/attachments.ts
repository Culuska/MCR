"use server";

import { createHash } from "node:crypto";
import { canSeeEntity } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWrite } from "@/lib/auth";
import { ActionError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { ENTITIES, describe, isEntity } from "@/lib/attachments";
import { MAX_PER_RECORD, humanSize, validate } from "@/lib/files";
import { putFile } from "@/lib/storage";
import { APPROVERS } from "@/lib/permissions";
import { formObject, optionalText, run, type FormState } from "@/lib/action";

export async function uploadAttachment(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const raw = formObject(fd);
    const entity = String(raw.entity ?? "");
    const entityId = String(raw.entityId ?? "");
    if (!isEntity(entity)) throw new ActionError("That kind of record cannot have attachments.");
    const user = await requireWrite(ENTITIES[entity].module);
    if (!(await canSeeEntity(user, entity, entityId))) throw new ActionError("You do not have access to that record.");
    const name = await describe(entity, entityId);
    if (!name) throw new ActionError(`That ${ENTITIES[entity].noun} does not exist.`);

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Choose a photo or PDF to attach.");
    const note = z.object({ note: optionalText }).parse({ note: raw.note }).note ?? null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    let checked;
    try { checked = validate(file.name, bytes); } catch (e) { throw new ActionError((e as Error).message); }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = await db.attachment.findMany({ where: { entity, entityId, removed: false }, select: { sha256: true, filename: true } });
    if (existing.length >= MAX_PER_RECORD) throw new ActionError(`A record can have at most ${MAX_PER_RECORD} attachments.`);
    const dup = existing.find((a) => a.sha256 === sha256);
    if (dup) throw new ActionError(`That file is already attached as ${dup.filename}.`);

    const storageKey = await putFile(bytes);
    const a = await db.attachment.create({ data: { entity, entityId, filename: checked.name, mime: checked.kind.mime, size: bytes.length, sha256, storageKey, note, uploadedById: user.id } });
    await audit({ userId: user.id, action: "attachment.add", entity, entityId, summary: `${user.name} attached ${a.filename} (${humanSize(a.size)}) to ${name}` });
    revalidatePath("/", "layout");
    return `${a.filename} attached`;
  });
}

// Never deletes the file. It is hidden from the record and the reason is kept in the history.
export async function removeAttachment(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const { id, reason } = z.object({ id: z.string(), reason: z.string().trim().min(3, "Say why it is being removed.") }).parse(formObject(fd));
    const a = await db.attachment.findUniqueOrThrow({ where: { id } });
    if (!isEntity(a.entity)) throw new ActionError("That attachment is not on a record that can be changed.");
    const user = await requireWrite(ENTITIES[a.entity].module);
    if (!(await canSeeEntity(user, a.entity, a.entityId))) throw new ActionError("You do not have access to that record.");
    if (a.removed) throw new ActionError("That attachment is already removed.");
    if (a.uploadedById !== user.id && !APPROVERS.includes(user.role)) throw new ActionError("Only the person who attached it, or finance staff, can remove it.");
    await db.attachment.update({ where: { id }, data: { removed: true, removedById: user.id, removedAt: new Date(), removeReason: reason } });
    await audit({ userId: user.id, action: "attachment.remove", entity: a.entity, entityId: a.entityId, summary: `${user.name} removed ${a.filename} from ${(await describe(a.entity, a.entityId)) ?? a.entityId}: ${reason}` });
    revalidatePath("/", "layout");
    return `${a.filename} removed`;
  });
}
