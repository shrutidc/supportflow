"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowUpRight,
  Inbox,
  Layers,
  LayoutDashboard,
  Settings,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Marks active when pathname matches and (if set) the view param matches. */
  view?: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Assigned to Me", href: "/inbox?view=assigned", icon: UserCheck, view: "assigned" },
  { label: "Escalations", href: "/inbox?view=escalations", icon: ArrowUpRight, view: "escalations" },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Settings", href: "/settings", icon: Settings },
];

function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");

  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
      {NAV_ITEMS.map((item) => {
        const basePath = item.href.split("?")[0];
        const isActive =
          pathname === basePath && (item.view ?? null) === (basePath === "/inbox" ? currentView : null);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Layers className="size-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">SupportFlow</span>
        </div>
        <div className="flex-1 overflow-y-auto py-3">
          <Suspense>
            <SidebarNav />
          </Suspense>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">Agent workspace</span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 md:pl-56">{children}</main>
    </div>
  );
}
