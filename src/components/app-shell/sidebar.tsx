"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Menu, SearchCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, activeNavHref } from "./nav";

function NavList({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin: boolean }) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);
  return (
    <nav aria-label="Main" className="space-y-5 px-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.14em] text-white/35 uppercase">{group.label}</p>
          <div className="space-y-0.5">
            {group.items
              .filter((item) => isAdmin || !("adminOnly" in item))
              .map(({ href, label, icon: Icon }) => {
                const isActive = active === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                      isActive
                        ? "bg-gradient-to-r from-white/[0.14] to-white/[0.04] font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
                        : "text-white/60 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    {isActive && <span className="absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-primary to-accent" aria-hidden />}
                    <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive ? "text-[#a5b4fc]" : "text-white/45 group-hover:text-white/80")} aria-hidden />
                    {label}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-6 text-sm font-semibold text-white">
      <span className="rounded-xl bg-gradient-to-br from-primary to-accent p-2 shadow-lg shadow-primary/30">
        <SearchCheck className="h-4 w-4" aria-hidden />
      </span>
      <span className="leading-tight">
        SEO Acquisition OS
        <span className="block text-[11px] font-normal text-white/45">Audit · Propose · Win</span>
      </span>
    </Link>
  );
}

function QuickCard({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="mx-3 mt-auto rounded-2xl border border-white/10 bg-gradient-to-br from-primary/25 via-white/[0.04] to-accent/20 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Sparkles className="h-4 w-4 text-[#c4b5fd]" /> Website → proposal
      </p>
      <p className="mt-1 text-xs text-white/55">Paste a URL; the audit and the proposal draft are prepared for you.</p>
      <Link
        href="/audits/new"
        onClick={onNavigate}
        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy transition-transform hover:translate-x-0.5"
      >
        Start now <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

const shell = "flex-col gap-6 overflow-y-auto bg-gradient-to-b from-navy via-navy to-navy-2 py-5";

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/5 lg:flex", shell)}>
      <Brand />
      <NavList isAdmin={isAdmin} />
      <QuickCard />
    </aside>
  );
}

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="rounded-lg p-2 text-text hover:bg-surface-2 lg:hidden"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="animate-fade absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className={cn("animate-rise absolute inset-y-0 left-0 flex w-72", shell)}>
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                type="button"
                className="rounded-lg p-2 text-white/70 hover:bg-white/10"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
            <QuickCard onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
