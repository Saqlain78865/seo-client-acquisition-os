import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { hasRole, requireSession } from "@/lib/auth";
import { ensureWorker } from "@/lib/jobs";
import { Badge, buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MobileNav, Sidebar } from "@/components/app-shell/sidebar";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { MotionEffects } from "@/components/motion";
import { logout } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  ensureWorker();
  const isAdmin = hasRole(session, "ADMIN");
  const initials = session.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-backdrop min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/70 bg-surface/75 px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6">
          <MobileNav isAdmin={isAdmin} />
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{session.workspace.name}</span>
            {session.workspace.isDemo && <Badge tone="warning">Demo data</Badge>}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/audits/new" className={cn(buttonClass("primary", "sm"), "mr-1 hidden sm:inline-flex")}>
              <Plus className="h-4 w-4" /> New audit
            </Link>
            <NotificationBell />
            <ThemeToggle />
            <div
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-white shadow-sm ring-2 ring-surface"
              title={`${session.user.name} · ${session.role.toLowerCase()}`}
            >
              {initials}
            </div>
            <form action={logout}>
              <button type="submit" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="page-enter mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
        <MotionEffects />
      </div>
    </div>
  );
}
