import { db } from "@/lib/db";
import { removeAttachment, uploadAttachment } from "@/actions/attachments";
import { ENTITIES, type EntityName } from "@/lib/attachments";
import { ACCEPT, MAX_BYTES, humanSize } from "@/lib/files";
import { APPROVERS, canWrite } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import { ActionForm, StepForm, Submit } from "@/components/ActionForm";
import { fmtDate } from "@/lib/money";

// Receipts, delivery notes and photos for one record. Anyone who can read the record can see them;
// anyone who can change it can add them.
export async function Attachments({ entity, id, user, title = "Attachments", hint, expected }: {
  entity: EntityName; id: string; user: SessionUser; title?: string; hint?: string; expected?: string;
}) {
  const [items, users] = await Promise.all([
    db.attachment.findMany({ where: { entity, entityId: id, removed: false }, orderBy: { createdAt: "asc" } }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const who = (uid: string) => users.find((u) => u.id === uid)?.name ?? "—";
  const writer = canWrite(user.role, ENTITIES[entity].module);

  return (
    <section className="panel">
      <div className="panel-head"><h2>{title}</h2><span className="small muted">{items.length ? `${items.length} file${items.length === 1 ? "" : "s"}` : "None yet"}</span></div>
      {hint && <span className="hint">{hint}</span>}
      {expected && items.length === 0 && <div className="notice" style={{ background: "var(--warn-soft)" }}>{expected}</div>}

      {items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {items.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 6, alignContent: "start", background: "var(--surface-2)" }}>
              <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" style={{ display: "grid", placeItems: "center", minHeight: 110, background: "var(--surface)", borderRadius: 6, overflow: "hidden" }} aria-label={`Open ${a.filename}`}>
                {a.mime.startsWith("image/")
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/files/${a.id}`} alt={a.filename} loading="lazy" style={{ maxWidth: "100%", maxHeight: 150, objectFit: "contain" }} />
                  : <span className="pill info" style={{ fontSize: 13 }}>PDF</span>}
              </a>
              <b style={{ fontSize: 13, wordBreak: "break-word" }}>{a.filename}</b>
              <span className="small muted">{humanSize(a.size)} · {who(a.uploadedById)} · {fmtDate(a.createdAt)}</span>
              {a.note && <span className="small">{a.note}</span>}
              <div className="row">
                <a className="small" href={`/api/files/${a.id}?download=1`}>Download</a>
                {writer && (a.uploadedById === user.id || APPROVERS.includes(user.role)) && <StepForm action={removeAttachment} id={a.id} to="REMOVE" label="Remove" ask="Why?" danger />}
              </div>
            </div>
          ))}
        </div>
      )}

      {writer && (
        <ActionForm action={uploadAttachment} resetOnOk>
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="entityId" value={id} />
          <div className="fields">
            <div className="field"><label htmlFor={`file-${entity}`}>Photo or PDF</label><input id={`file-${entity}`} name="file" type="file" accept={ACCEPT} required /></div>
            <div className="field"><label htmlFor={`note-${entity}`}>Note</label><input id={`note-${entity}`} name="note" placeholder="Optional" /></div>
          </div>
          <div className="row"><Submit>Attach</Submit><span className="hint">JPEG, PNG, WebP or PDF, up to {humanSize(MAX_BYTES)}.</span></div>
        </ActionForm>
      )}
    </section>
  );
}
