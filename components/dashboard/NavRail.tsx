"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CheckSquare,
  Calendar,
  Target,
  FolderKanban,
  HeartPulse,
  BookOpen,
  Users,
  Briefcase,
  Scale,
  ShieldAlert,
  Wallet,
  GraduationCap,
  Share2,
  Sparkles,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
} from "lucide-react";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/health", label: "Health", icon: HeartPulse },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/crm", label: "CRM", icon: Users },
  { href: "/opportunities", label: "Opportunities", icon: Briefcase },
  { href: "/decisions", label: "Decisions", icon: Scale },
  { href: "/risks", label: "Risks", icon: ShieldAlert },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/learning", label: "Learning", icon: GraduationCap },
  { href: "/graph", label: "Graph", icon: Share2 },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const STORAGE_KEY = "nav.collapsed";

export function NavRail({ email }: { email: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore the desktop collapsed preference once on the client.
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    setHydrated(true);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const width = collapsed ? "w-16" : "w-56";

  return (
    <>
      {/* Mobile top bar with hamburger (hidden on md+) */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-ink-1 px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-1.5 text-ink-3 hover:bg-ink-2 hover:text-ink-4"
        >
          <Menu size={20} />
        </button>
        <span className="text-sm font-semibold text-ink-4">Personal OS</span>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          "flex shrink-0 flex-col border-r border-line bg-ink-1 p-3 transition-[width] duration-200",
          // desktop: in-flow, collapsible width
          "hidden md:flex",
          hydrated ? width : "w-56",
          // mobile: off-canvas drawer
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-64",
          mobileOpen ? "max-md:flex" : "max-md:hidden",
        ].join(" ")}
      >
        {/* Header: brand + collapse / close toggles */}
        <div className="flex items-center justify-between px-2 py-3">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-4">Personal OS</p>
              <p className="truncate text-xs text-ink-3">{email}</p>
            </div>
          )}
          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            className="hidden rounded-lg p-1.5 text-ink-3 hover:bg-ink-2 hover:text-ink-4 md:block"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {/* Mobile close */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-ink-2 hover:text-ink-4 md:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  collapsed ? "md:justify-center" : ""
                } ${
                  active
                    ? "bg-ink-2 text-ink-4"
                    : "text-ink-3 hover:bg-ink-2 hover:text-ink-4"
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className={collapsed ? "md:hidden" : ""}>{label}</span>
              </Link>
            );
          })}
        </nav>

        <form action="/api/auth/signout" method="post" className="pt-2">
          <button
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-3 hover:bg-ink-2 hover:text-ink-4 ${
              collapsed ? "md:justify-center" : ""
            }`}
          >
            <LogOut size={16} className="shrink-0" />
            <span className={collapsed ? "md:hidden" : ""}>Sign out</span>
          </button>
        </form>
      </aside>
    </>
  );
}
