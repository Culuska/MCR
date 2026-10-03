import Link from "next/link";
import { STATUS_TONE, label } from "@/lib/domain";

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Pill({ status, text }: { status: string; text?: string }) {
  return <span className={`pill ${STATUS_TONE[status] ?? ""}`}>{text ?? label(status)}</span>;
}

export const Sample = ({ name }: { name: string }) => (name.includes("(sample)") ? <span className="pill sample">Sample</span> : null);
export const clean = (name: string) => name.replace(" (sample)", "");

export function Kpi({ label: l, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "in" | "out" }) {
  return (
    <div className="kpi">
      <span className="label">{l}</span>
      <span className={`v${tone ? " " + tone : ""}`}>{value}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  );
}

export function Bar({ used, tone }: { used: number; tone?: "rust" }) {
  const cls = tone ?? (used >= 100 ? "bad" : used >= 85 ? "warn" : "");
  return <div className={`bar ${cls}`} role="img" aria-label={`${Math.round(used)} percent`}><span style={{ width: `${Math.min(used, 100)}%` }} /></div>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <span>{children}</span>}</div>;
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((i) => <Link key={i.key} href={i.href} aria-current={i.key === current ? "page" : undefined}>{i.label}</Link>)}
    </nav>
  );
}

export function Field({ name, label: l, children, wide, hint }: { name: string; label: string; children: React.ReactNode; wide?: boolean; hint?: string }) {
  return <div className={`field${wide ? " wide" : ""}`}><label htmlFor={name}>{l}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}
