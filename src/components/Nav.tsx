"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICON: Record<string, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  projects: "M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6",
  expenses: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  invoices: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  customers: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 21c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M17 4.8a3.5 3.5 0 0 1 0 6.4M19 15c1.6.8 2.6 2.6 3 6",
  suppliers: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  attendance: "M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1zM9 14l2 2 4-4",
  employees: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  payroll: "M3 7h18v10H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 10v.01M18 14v.01",
  assets: "M3 17h13M5 17V9l4-4h6l3 4v8M7 17a2 2 0 1 0 4 0M13 17a2 2 0 1 0 4 0M9 9h5",
  materials: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  subcontracts: "M4 20V9l8-5 8 5v11M9 20v-6h6v6M9 10h.01M15 10h.01",
  operations: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9",
  finance: "M4 7h16v12H4zM4 7l2-3h12l2 3M15 13h2",
  reports: "M5 20V10M12 20V4M19 20v-7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
};

export function Nav({ items }: { items: { href: string; label: string; key: string }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.key} href={i.href} aria-current={active ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[i.key]} /></svg>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
