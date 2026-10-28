"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, FileText, Globe, Pause, Play, RotateCcw, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const SCENE_MS = 3000;
const SCENES = [
  { key: "paste", label: "Paste", title: "Paste a website" },
  { key: "audit", label: "Audit", title: "A full audit in minutes" },
  { key: "proof", label: "Proof", title: "Every issue, with proof" },
  { key: "proposal", label: "Proposal", title: "A proposal that sells" },
  { key: "won", label: "Won", title: "Client accepts — deal won" },
] as const;

export type ReelScene = { key: string; label: string; title: string };

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const m = window.matchMedia(MOTION_QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** Inline style with custom properties used by the reel's CSS animations. */
const v = (vars: Record<string, string | number>) => vars as React.CSSProperties;

/**
 * 15-second motion-graphics loop for the dashboard: website → audit → proof → proposal → won.
 * Pure CSS animations driven by a scene timer; pausing freezes both. Shown as decoration only —
 * the numbers are illustrative, not workspace data.
 */
export function HeroReel({ className }: { className?: string }) {
  return (
    <Reel
      scenes={SCENES}
      label="How it works — 15-second animation"
      summary="Paste a website, the audit runs, issues are shown with screenshots, a proposal is prepared, and the client accepts it online."
      className={className}
      render={(key) => (
        <>
          {key === "paste" && <ScenePaste />}
          {key === "audit" && <SceneAudit />}
          {key === "proof" && <SceneProof />}
          {key === "proposal" && <SceneProposal />}
          {key === "won" && <SceneWon />}
        </>
      )}
    />
  );
}

/** The reel's frame: scene timer, pause/replay, step title and progress bar. Scenes are drawn by `render`. */
export function Reel({ scenes, render, label, summary, className }: { scenes: readonly ReelScene[]; render: (key: string) => React.ReactNode; label: string; summary: string; className?: string }) {
  // `loop` counts plays, so every scene start gets a fresh key and its CSS animations restart.
  const [{ scene, loop }, setPosition] = useState({ scene: 0, loop: 0 });
  // "Reduce motion" starts it paused; the person can still press play.
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION_QUERY).matches, () => false);
  const [manualPause, setManualPause] = useState<boolean | null>(null);
  const paused = manualPause ?? reducedMotion;
  const remaining = useRef(SCENE_MS);
  const timedKey = useRef("");

  const goTo = useCallback((s: number) => setPosition((p) => ({ scene: s, loop: p.loop + 1 })), []);

  // Each scene gets the full 3 s; pausing and resuming within a scene keeps the time that is left.
  useEffect(() => {
    if (paused) return;
    const key = `${loop}-${scene}`;
    if (timedKey.current !== key) {
      timedKey.current = key;
      remaining.current = SCENE_MS;
    }
    const started = performance.now();
    const budget = remaining.current;
    const id = setTimeout(() => goTo((scene + 1) % scenes.length), budget);
    return () => {
      clearTimeout(id);
      remaining.current = Math.max(0, budget - (performance.now() - started));
    };
  }, [scene, loop, paused, goTo, scenes.length]);

  const replay = () => {
    goTo(0);
    setManualPause(false);
  };

  const current = scenes[scene];
  return (
    <section
      aria-label={label}
      data-paused={paused}
      className={cn("reel relative flex min-h-[330px] flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[#070b22] via-navy-2 to-[#22175e] text-white shadow-lift", className)}
    >
      <p className="sr-only">{summary}</p>
      {/* Ambient light and grid */}
      <div aria-hidden className="reel-orb pointer-events-none absolute -top-20 -left-16 h-64 w-64 rounded-full bg-primary/45 blur-3xl" />
      <div aria-hidden className="reel-orb pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full bg-accent/35 blur-3xl" style={{ animationDelay: "-4s" }} />
      <div aria-hidden className="reel-grid pointer-events-none absolute inset-0 opacity-[0.07]" />

      <header className="relative flex items-center justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-white/50 uppercase">
            Step {scene + 1} of {scenes.length}
          </p>
          <h2 key={`t-${loop}-${scene}`} className="reel-in truncate text-lg font-bold tracking-tight">
            {current.title}
          </h2>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => setManualPause(!paused)} aria-label={paused ? "Play animation" : "Pause animation"} className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white">
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" onClick={replay} aria-label="Replay animation" className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div key={`s-${loop}-${scene}`} aria-hidden className="relative flex-1 px-5 py-3">
        {render(current.key)}
      </div>

      <footer className="relative grid gap-1.5 px-5 pb-4" style={{ gridTemplateColumns: `repeat(${scenes.length}, minmax(0, 1fr))` }}>
        {scenes.map((s, i) => (
          <button key={s.key} type="button" onClick={() => goTo(i)} className="group text-left" aria-label={`Show step ${i + 1}: ${s.title}`}>
            <span className="block h-1 overflow-hidden rounded-full bg-white/12">
              {i < scene && <span className="block h-full w-full rounded-full bg-gradient-to-r from-[#a5b4fc] to-[#c4b5fd]" />}
              {i === scene && <span key={`p-${loop}-${scene}`} className="reel-fill block h-full rounded-full bg-gradient-to-r from-[#a5b4fc] to-[#c4b5fd]" />}
            </span>
            <span className={cn("mt-1.5 hidden text-[11px] font-medium transition sm:block", i === scene ? "text-white" : "text-white/40 group-hover:text-white/70")}>{s.label}</span>
          </button>
        ))}
      </footer>
    </section>
  );
}

function ScenePaste() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="reel-in flex w-full max-w-md items-center gap-2 rounded-2xl bg-white/10 p-2 pl-4 ring-1 ring-white/15 backdrop-blur">
        <Globe className="h-4 w-4 shrink-0 text-white/55" />
        <span className="reel-type font-mono text-sm text-white">clientwebsite.com</span>
        <span className="reel-caret h-4 w-px bg-white" />
        <span className="reel-press ml-auto rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-navy shadow-lg">Audit &amp; propose</span>
      </div>
      <div className="flex gap-2">
        {["Pages", "Speed", "Domain", "Google Business"].map((t, i) => (
          <span key={t} className="reel-rise rounded-full bg-white/8 px-3 py-1 text-[11px] text-white/70 ring-1 ring-white/10" style={{ animationDelay: `${1.7 + i * 0.15}s` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const TILE_COLORS = ["#4ade80", "#4ade80", "#fbbf24", "#4ade80", "#f87171", "#4ade80", "#fbbf24", "#4ade80", "#4ade80", "#f87171", "#4ade80", "#fbbf24"];

function SceneAudit() {
  const circumference = 2 * Math.PI * 42;
  return (
    <div className="grid h-full grid-cols-[1fr_auto] items-center gap-6">
      <div className="relative">
        <div className="grid grid-cols-4 gap-2">
          {TILE_COLORS.map((c, i) => (
            <div key={i} className="reel-tile rounded-lg bg-white/6 p-2 ring-1 ring-white/10" style={v({ "--c": c, animationDelay: `${0.15 + i * 0.12}s` })}>
              <div className="h-1 w-3/4 rounded bg-white/30" />
              <div className="mt-1 h-1 w-1/2 rounded bg-white/15" />
              <div className="reel-dot mt-1.5 h-1.5 w-1.5 rounded-full" style={v({ "--c": c, animationDelay: `${0.4 + i * 0.12}s` })} />
            </div>
          ))}
        </div>
        <div className="reel-scan pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-[#a5b4fc]/35 to-transparent" />
        <p className="mt-3 text-xs text-white/60">
          <span className="reel-count font-semibold text-white tabular-nums" style={v({ "--to": 36, "--dur": "2s" })} /> pages crawled
        </p>
      </div>
      <div className="relative grid place-items-center">
        <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="url(#reel-ring)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            className="reel-ring"
            style={v({ "--from": circumference, "--to-off": circumference * (1 - 0.62) })}
          />
          <defs>
            <linearGradient id="reel-ring" x1="0" x2="1">
              <stop offset="0" stopColor="#fbbf24" />
              <stop offset="1" stopColor="#f472b6" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute text-center">
          <span className="reel-count block text-3xl font-bold tabular-nums" style={v({ "--to": 62, "--dur": "1.8s", "--delay": "0.4s" })} />
          <span className="text-[10px] tracking-wide text-white/55 uppercase">SEO health</span>
        </div>
      </div>
    </div>
  );
}

const ISSUES = [
  { tone: "#f87171", sev: "Critical", text: "12 pages have no meta description" },
  { tone: "#fbbf24", sev: "High", text: "Mobile page loads in 4.8 s" },
  { tone: "#a5b4fc", sev: "Medium", text: "2 Google reviews without a reply" },
];

function SceneProof() {
  return (
    <div className="grid h-full grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-3 sm:gap-5">
      <div className="reel-in overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-white/20">
        <div className="flex gap-1 bg-[#e5e7eb] px-2 py-1.5">
          {["#f87171", "#fbbf24", "#4ade80"].map((c) => (
            <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <div className="space-y-1.5 p-3">
          <div className="h-1.5 w-1/3 rounded bg-[#cbd5e1]" />
          <div className="reel-outline relative rounded-md p-1.5">
            <div className="h-3 w-4/5 rounded bg-[#334155]" />
            <div className="mt-1 h-1.5 w-3/5 rounded bg-[#94a3b8]" />
            <span className="reel-rise absolute -top-2.5 right-1 rounded bg-[#dc2626] px-1.5 py-0.5 text-[8px] font-bold text-white" style={{ animationDelay: "0.9s" }}>
              Missing H1
            </span>
          </div>
          <div className="h-1.5 w-full rounded bg-[#e2e8f0]" />
          <div className="h-1.5 w-11/12 rounded bg-[#e2e8f0]" />
          <div className="h-6 w-1/3 rounded bg-[#6366f1]/80" />
        </div>
      </div>
      <ul className="space-y-2">
        {ISSUES.map((i, n) => (
          <li key={i.sev} className="reel-slide flex items-center gap-2.5 rounded-xl bg-white/8 px-3 py-2 ring-1 ring-white/10 backdrop-blur" style={{ animationDelay: `${0.5 + n * 0.35}s` }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: i.tone, boxShadow: `0 0 12px ${i.tone}` }} />
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold tracking-wide uppercase" style={{ color: i.tone }}>
                {i.sev}
              </span>
              <span className="block text-xs leading-snug text-white/85">{i.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SceneProposal() {
  return (
    <div className="grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-6">
      <div className="relative h-44 w-36">
        {[-9, 6].map((r, i) => (
          <div key={r} className="reel-sheet absolute inset-0 rounded-xl bg-white/85 shadow-xl" style={v({ "--r": `${r}deg`, animationDelay: `${i * 0.15}s` })} />
        ))}
        <div className="reel-sheet absolute inset-0 overflow-hidden rounded-xl bg-white p-3 text-navy shadow-2xl" style={v({ "--r": "0deg", animationDelay: "0.3s" })}>
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-primary" />
            <span className="text-[9px] font-bold">SEO Proposal</span>
          </div>
          {[0.95, 0.7, 0.85, 0.55, 0.8].map((w, i) => (
            <div key={i} className="reel-line mt-1.5 h-1 rounded bg-[#cbd5e1]" style={{ width: `${w * 100}%`, animationDelay: `${0.7 + i * 0.12}s` }} />
          ))}
          <div className="reel-rise mt-2.5 flex items-center gap-0.5" style={{ animationDelay: "1.4s" }}>
            {[0, 1, 2, 3, 4].map((s) => (
              <Star key={s} className={cn("h-2.5 w-2.5", s < 4 ? "fill-[#f59e0b] text-[#f59e0b]" : "text-[#cbd5e1]")} />
            ))}
            <span className="ml-1 text-[8px] font-semibold text-[#475569]">4.1 Google</span>
          </div>
          <div className="reel-rise mt-2 rounded-md bg-gradient-to-r from-primary to-accent px-1.5 py-1 text-center text-[8px] font-bold text-white" style={{ animationDelay: "1.7s" }}>
            Reputation plan included
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {["Findings with screenshots", "Google Business & reviews", "Keywords and a 90-day plan", "Accept online in one click"].map((t, i) => (
          <p key={t} className="reel-slide flex items-center gap-2 text-sm text-white/85" style={{ animationDelay: `${0.6 + i * 0.3}s` }}>
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#4ade80]/20 text-[#4ade80]">
              <Check className="h-3 w-3" />
            </span>
            {t}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Counts up with thousands separators (CSS counters cannot add the comma). */
export function CountUp({ to, delayMs, durationMs }: { to: number; delayMs: number; durationMs: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now() + delayMs;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / durationMs));
      setValue(Math.round(to * (1 - Math.pow(1 - p, 4))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, delayMs, durationMs]);
  return <span className="tabular-nums">{value.toLocaleString("en-US")}</span>;
}

const CONFETTI = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 10) / 10,
  color: ["#a5b4fc", "#f472b6", "#fbbf24", "#4ade80", "#c4b5fd", "#38bdf8"][i % 6],
  size: 5 + (i % 3) * 2,
  spin: i % 2 ? 540 : -480,
}));

function SceneWon() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className="reel-confetti absolute top-0 rounded-[2px]"
          style={v({ left: `${c.left}%`, width: c.size, height: c.size * 1.6, background: c.color, animationDelay: `${0.35 + c.delay}s`, "--spin": `${c.spin}deg` })}
        />
      ))}
      <div className="relative grid place-items-center">
        <span className="reel-burst absolute h-20 w-20 rounded-full border-2 border-[#4ade80]" />
        <span className="reel-burst absolute h-20 w-20 rounded-full border border-[#4ade80]/60" style={{ animationDelay: "0.35s" }} />
        <span className="reel-pop grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#22c55e] to-[#059669] shadow-[0_0_40px_rgb(34_197_94/0.55)]">
          <Check className="h-10 w-10" strokeWidth={3} />
        </span>
      </div>
      <p className="reel-rise mt-4 text-sm text-white/70" style={{ animationDelay: "0.6s" }}>
        Proposal accepted online
      </p>
      <p className="reel-rise text-2xl font-bold tracking-tight" style={{ animationDelay: "0.8s" }}>
        Deal won · $<CountUp to={1500} delayMs={900} durationMs={1400} />
        <span className="text-base font-medium text-white/60">/mo</span>
      </p>
    </div>
  );
}
