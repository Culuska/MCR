import { requireUser } from "@/lib/auth";
import { canRead, ROLE_LABEL, type Module } from "@/lib/permissions";
import { logout } from "@/actions/auth";
import { Nav } from "@/components/Nav";

const ITEMS: { href: string; label: string; key: string; module: Module }[] = [
  { href: "/", label: "Overview", key: "dashboard", module: "dashboard" },
  { href: "/projects", label: "Projects", key: "projects", module: "projects" },
  { href: "/expenses", label: "Expenses", key: "expenses", module: "expenses" },
  { href: "/invoices", label: "Invoices", key: "invoices", module: "invoices" },
  { href: "/customers", label: "Customers", key: "customers", module: "customers" },
  { href: "/suppliers", label: "Suppliers", key: "suppliers", module: "suppliers" },
  { href: "/operations", label: "Site operations", key: "operations", module: "operations" },
  { href: "/attendance", label: "Attendance", key: "attendance", module: "attendance" },
  { href: "/employees", label: "Employees", key: "employees", module: "payroll" },
  { href: "/payroll", label: "Payroll", key: "payroll", module: "payroll" },
  { href: "/assets", label: "Equipment", key: "assets", module: "assets" },
  { href: "/subcontracts", label: "Subcontracts", key: "subcontracts", module: "subcontracts" },
  { href: "/materials", label: "Materials", key: "materials", module: "stock" },
  { href: "/finance", label: "Finance", key: "finance", module: "finance" },
  { href: "/reports", label: "Reports", key: "reports", module: "reports" },
  { href: "/settings", label: "Settings", key: "settings", module: "settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = ITEMS.filter((i) => canRead(user.role, i.module));
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><b>MCR</b><span>Mogadishu Construction &amp; Rehabilitation</span></div>
        <Nav items={items} />
        <div className="who">
          <div><b>{user.name}</b><br />{ROLE_LABEL[user.role]}</div>
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
