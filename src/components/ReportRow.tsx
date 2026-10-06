"use client";
import { useRef, useState } from "react";

type Rep = { key: string; title: string; filters?: ("date" | "project" | "asof")[] };

// One report: its filters, a PDF preview in a window over the page, and the two downloads.
export function ReportRow({ rep, projects }: { rep: Rep; projects: { id: string; code: string }[] }) {
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState("");

  const url = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (form.current) for (const [k, v] of new FormData(form.current)) if (typeof v === "string" && v) q.set(k, v);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `/api/reports/${rep.key}?${q}`;
  };
  const preview = () => { setSrc(url({ format: "pdf" })); dialog.current?.showModal(); };
  const close = () => { dialog.current?.close(); setSrc(""); };

  return (
    <>
      <form ref={form} onSubmit={(e) => { e.preventDefault(); preview(); }} className="filters" style={{ justifyContent: "space-between", paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
        <b style={{ minWidth: 200 }}>{rep.title}</b>
        <div className="filters">
          {rep.filters?.includes("date") && (<>
            <input type="date" name="from" aria-label={`${rep.title} from date`} /><span className="muted">to</span><input type="date" name="to" aria-label={`${rep.title} to date`} />
          </>)}
          {rep.filters?.includes("asof") && (<>
            <label className="small muted" htmlFor={`${rep.key}-to`}>As of</label><input id={`${rep.key}-to`} type="date" name="to" />
            <label className="small muted" htmlFor={`${rep.key}-cmp`}>Compare with</label><input id={`${rep.key}-cmp`} type="date" name="compare" />
          </>)}
          {rep.filters?.includes("project") && (
            <select name="project" aria-label={`${rep.title} project`}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
          )}
          <button type="submit" className="btn sm primary">Preview PDF</button>
          <button type="button" className="btn sm" onClick={() => { window.location.href = url({ format: "pdf", download: "1" }); }}>Download PDF</button>
          <button type="button" className="btn sm" onClick={() => { window.location.href = url({}); }}>CSV</button>
        </div>
      </form>

      <dialog ref={dialog} className="pv" onClose={() => setSrc("")} aria-label={`${rep.title} preview`}>
        <div className="pv-bar">
          <b>{rep.title}</b>
          <span className="pv-actions">
            <a className="btn sm primary" href={src ? `${src}&download=1` : "#"}>Download PDF</a>
            <a className="btn sm" href={src || "#"} target="_blank" rel="noreferrer">Open in new tab</a>
            <button type="button" className="btn sm" onClick={close}>Close</button>
          </span>
        </div>
        {src && <iframe title={`${rep.title} PDF preview`} src={src} className="pv-frame" />}
      </dialog>
    </>
  );
}
