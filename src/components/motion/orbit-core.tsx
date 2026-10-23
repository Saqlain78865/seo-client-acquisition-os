"use client";

import { useEffect, useState } from "react";
import { BarChart3, FileText, MailOpen, ScanSearch, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type CardState = { icon: LucideIcon; title: string; lines: string[] };

// Each floating card cycles through a few illustrative states.
const CARDS: { pos: string; delay: number; states: CardState[]; kind: "progress" | "typing" | "bars" | "checks" }[] = [
  { pos: "left-0 top-6", delay: 0, kind: "progress", states: [{ icon: ScanSearch, title: "Audit", lines: ["Crawling 36 pages…", "Speed & domain checked", "17 issues found"] }] },
  { pos: "right-0 top-2", delay: 0.6, kind: "typing", states: [{ icon: MailOpen, title: "Client", lines: ["Opened your proposal", "Reading “Key findings”", "Accepted online ✓"] }] },
  { pos: "left-4 bottom-6", delay: 1.2, kind: "checks", states: [{ icon: FileText, title: "Proposal", lines: ["Findings added", "Screenshots attached", "Ready to send"] }] },
  { pos: "right-2 bottom-0", delay: 1.8, kind: "bars", states: [{ icon: BarChart3, title: "Growth", lines: ["Score 48 → 81"] }] },
];

/**
 * Decorative "SEO core": an orb with tilted orbits, light pulses travelling along them and
 * floating glass cards whose status changes every few seconds. Illustrative only.
 */
export function OrbitCore({ className }: { className?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setTick((t) => t + 1), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <div aria-hidden className={cn("relative mx-auto aspect-square w-full max-w-[460px]", className)}>
      {/* Orbits */}
      <div className="orbit-ring absolute inset-[14%] rounded-full border border-[#67e8f9]/25" />
      <div className="orbit-ring absolute inset-[4%] rounded-full border border-dashed border-[#a78bfa]/20" style={{ animationDirection: "reverse", animationDuration: "60s" }} />
      <div className="absolute inset-x-[2%] top-1/2 h-[34%] -translate-y-1/2 -rotate-12 rounded-[50%] border border-[#67e8f9]/20" />
      {/* Pulses travelling around the orbits */}
      <div className="orbit-spin absolute inset-[14%]">
        <span className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_4px_rgb(103_232_249/0.7)]" />
      </div>
      <div className="orbit-spin absolute inset-[4%]" style={{ animationDuration: "14s", animationDirection: "reverse" }}>
        <span className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-[#c4b5fd] shadow-[0_0_12px_3px_rgb(167_139_250/0.7)]" />
      </div>
      {/* The core */}
      <div className="absolute inset-[33%] grid place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#312e81,#0b1130_70%)] shadow-[0_0_60px_8px_rgb(99_102_241/0.45),inset_0_0_30px_rgb(103_232_249/0.25)] ring-1 ring-[#67e8f9]/40">
        <span className="orbit-pulse absolute inset-0 rounded-full ring-2 ring-[#67e8f9]/40" />
        <div className="text-center">
          <p className="text-3xl font-bold tracking-tight text-white">SEO</p>
          <p className="font-mono text-[10px] tracking-[0.3em] text-[#67e8f9]">CORE</p>
        </div>
      </div>
      {/* Floating status cards */}
      {CARDS.map((c, i) => {
        const s = c.states[0];
        const line = s.lines[(tick + i) % s.lines.length];
        const step = (tick + i) % s.lines.length;
        return (
          <div key={s.title} className={cn("orbit-float absolute w-[46%] max-w-[200px] rounded-xl border border-white/10 bg-[#0b1130]/70 p-3 text-white shadow-2xl backdrop-blur-md", c.pos)} style={{ animationDelay: `${c.delay}s` }}>
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <s.icon className="h-3.5 w-3.5 text-[#67e8f9]" /> {s.title}
            </p>
            <p key={line} className="orbit-line mt-1 truncate text-[11px] text-white/70">
              {line}
            </p>
            {c.kind === "progress" && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-[#67e8f9] to-[#a78bfa] transition-[width] duration-[1800ms] ease-out" style={{ width: `${[35, 70, 100][step]}%` }} />
              </div>
            )}
            {c.kind === "typing" && (
              <div className="mt-2 inline-flex gap-1 rounded-full bg-white/10 px-2 py-1">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="orbit-dot h-1 w-1 rounded-full bg-[#c4b5fd]" style={{ animationDelay: `${d * 0.18}s` }} />
                ))}
              </div>
            )}
            {c.kind === "checks" && (
              <div className="mt-2 flex gap-1">
                {[0, 1, 2].map((d) => (
                  <span key={d} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-700", d <= step ? "bg-[#4ade80]" : "bg-white/10")} />
                ))}
              </div>
            )}
            {c.kind === "bars" && (
              <div className="mt-2 flex h-7 items-end gap-1">
                {[30, 45, 40, 62, 70, 88].map((hgt, d) => (
                  <span key={d} className="flex-1 rounded-sm bg-gradient-to-t from-[#6366f1] to-[#67e8f9] transition-[height] duration-1000" style={{ height: `${tick % 2 ? hgt : Math.max(15, hgt - 22)}%`, opacity: 0.55 + d * 0.08 }} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
