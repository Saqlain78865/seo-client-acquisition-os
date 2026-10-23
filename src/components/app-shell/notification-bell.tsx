"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";

type Item = { id: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };

const POLL_MS = 30_000;

/** Header bell: polls for workspace alerts (proposal opened/accepted, audits finished) and toasts new ones. */
export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: Item[] };
      // Only alerts that arrive while the app is open pop up; the first load just fills the list.
      if (seen.current) {
        for (const n of data.items) {
          if (!n.read && !seen.current.has(n.id)) toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: "Open", onClick: () => (window.location.href = n.link!) } : undefined });
        }
      }
      seen.current = new Set(data.items.map((n) => n.id));
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // Offline or server restarting: try again on the next poll.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function markRead() {
    await fetch("/api/notifications", { method: "POST" }).catch(() => null);
    setUnread(0);
    setItems((list) => list.map((n) => ({ ...n, read: true })));
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-text"
        aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-pop absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markRead} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No notifications yet. You will be told here when a client opens or accepts a proposal.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <>
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      <p className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</p>
                    </div>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-muted">{timeAgo(n.createdAt)}</p>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => setOpen(false)} className="block px-4 py-3 transition-colors hover:bg-surface-2">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
