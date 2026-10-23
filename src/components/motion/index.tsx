"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export { Constellation } from "./constellation";
export { OrbitCore } from "./orbit-core";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const m = window.matchMedia(MOTION_QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION_QUERY).matches, () => false);
}

/** Small mono, letter-spaced label that types itself out, with a blinking caret. */
export function Typewriter({ text, className, speed = 45 }: { text: string; className?: string; speed?: number }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setN((x) => (x >= text.length ? x : x + 1)), speed);
    return () => clearInterval(id);
  }, [text, speed, reduced]);
  const shown = reduced ? text : text.slice(0, n);
  return (
    <p className={cn("inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.22em] uppercase", className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" aria-hidden />
      <span aria-label={text}>
        <span aria-hidden>{shown}</span>
        <span aria-hidden className="type-caret ml-0.5 inline-block h-3 w-px translate-y-0.5 bg-current" />
      </span>
    </p>
  );
}

/** Endless sideways strip of short phrases. */
export function Marquee({ items, className }: { items: string[]; className?: string }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="marquee-track flex shrink-0 items-center gap-8 pr-8">
      {items.map((t) => (
        <li key={t} className="flex items-center gap-8 whitespace-nowrap">
          {t}
          <span className="text-[#67e8f9]">✦</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("marquee flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]", className)}>
      {row(false)}
      {row(true)}
    </div>
  );
}

export type TickerItem = { at: string; text: string };

/** "LIVE · 11:05 PM › …" pill that cycles through recent events. */
export function LiveTicker({ items, label = "Live", className }: { items: TickerItem[]; label?: string; className?: string }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced || items.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % items.length), 3800);
    return () => clearInterval(id);
  }, [items.length, reduced]);
  if (!items.length) return null;
  const item = items[i % items.length];
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-sm backdrop-blur", className)} aria-live="polite">
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-[#67e8f9] uppercase">
        <span className="ticker-dot h-1.5 w-1.5 rounded-full bg-[#67e8f9]" />
        {label}
      </span>
      <span key={i} className="ticker-in min-w-0 truncate text-white/80">
        <span className="font-mono text-xs text-white/50">{item.at}</span> <span className="text-white/40">›</span> {item.text}
      </span>
    </div>
  );
}

/**
 * Page-wide helpers: a soft light that follows the cursor over `.spotlight` cards, and blur-in
 * reveals for `.reveal` elements as they scroll into view. Without JavaScript everything is visible.
 */
export function MotionEffects() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(".spotlight") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });

    document.documentElement.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    const watch = () => document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => io.observe(el));
    watch();
    // Client-side navigation adds new pages without a reload.
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return null;
}
