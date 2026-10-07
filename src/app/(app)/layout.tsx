import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canRead, ROLE_LABEL, type Module } from "@/lib/permissions";
import { logout } from "@/actions/auth";
import { Nav } from "@/components/Nav";

// The menu is grouped by department so only the part you are working in needs to be open.
const DEPARTMENTS: { title: string; items: { href: string; label: string; key: string; module: Module }[] }[] = [
  { title: "Operations", items: [
    { href: "/projects", label: "Projects", key: "projects", module: "projects" },
    { href: "/operations", label: "Site operations", key: "operations", module: "operations" },
    { href: "/assets", label: "Equipment", key: "assets", module: "assets" },
    { href: "/materials", label: "Materials", key: "materials", module: "stock" },
    { href: "/subcontracts", label: "Subcontracts", key: "subcontracts", module: "subcontracts" },
  ] },
  { title: "Customers and suppliers", items: [
    { href: "/customers", label: "Customers", key: "customers", module: "customers" },
    { href: "/suppliers", label: "Suppliers", key: "suppliers", module: "suppliers" },
  ] },
  { title: "Finance", items: [
    { href: "/expenses", label: "Expenses", key: "expenses", module: "expenses" },
    { href: "/invoices", label: "Invoices", key: "invoices", module: "invoices" },
    { href: "/finance", label: "Books and statements", key: "finance", module: "finance" },
    { href: "/reports", label: "Reports", key: "reports", module: "reports" },
  ] },
  { title: "People", items: [
    { href: "/attendance", label: "Attendance", key: "attendance", module: "attendance" },
    { href: "/employees", label: "Employees", key: "employees", module: "payroll" },
    { href: "/payroll", label: "Payroll", key: "payroll", module: "payroll" },
  ] },
  { title: "Administration", items: [
    { href: "/settings", label: "Settings", key: "settings", module: "settings" },
  ] },
];
const OVERVIEW = { href: "/", label: "Overview", key: "dashboard", module: "dashboard" as Module };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Each person only gets the departments (and items) their role can open.
  const groups = DEPARTMENTS.map((d) => ({ title: d.title, items: d.items.filter((i) => canRead(user.role, i.module)).map(({ href, label, key }) => ({ href, label, key })) })).filter((d) => d.items.length > 0);
  const top = canRead(user.role, OVERVIEW.module) ? [{ href: OVERVIEW.href, label: OVERVIEW.label, key: OVERVIEW.key }] : [];
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><b>MCR</b><span>Mogadishu Construction &amp; Rehabilitation</span></div>
        <Nav top={top} groups={groups} />
        <div className="who">
          <div><b>{user.name}</b><br />{ROLE_LABEL[user.role]}</div>
          <Link href="/account" className="small" style={{ color: "inherit" }}>Account and password</Link>
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
