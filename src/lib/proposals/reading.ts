import "server-only";
import { z } from "zod";
import { db } from "../db";
import { SECTION_DEFS } from "./types";

/** One beat sent by the client's browser: reading time per section since the previous beat. */
export const readBeatSchema = z.object({
  visitorKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  device: z.enum(["DESKTOP", "MOBILE"]),
  sections: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.number().int().min(0).max(60_000)).refine((s) => Object.keys(s).length <= 40, "Too many sections"),
});
export type ReadBeat = z.infer<typeof readBeatSchema>;

// A beat covers ~10 s of reading, so anything far above that is not a real person reading.
const MAX_BEAT_MS = 30_000;
// One visit stops counting after 4 hours (a tab left open is not reading).
const MAX_VISIT_MS = 4 * 3600_000;

/** The parts of the proposal where a decision is made. */
export const DECISION_SECTIONS = ["deliverables", "next_steps", "acceptance"] as const;

const TITLES: Record<string, string> = {
  cover: "Cover page",
  glance: "At a glance",
  ...Object.fromEntries(SECTION_DEFS.map((s) => [s.key, s.title])),
};

/** Adds one beat to the visit. Returns the visit's total so far, or null when the beat was ignored. */
export async function recordReadBeat(proposalId: string, version: number, beat: ReadBeat): Promise<number | null> {
  const entries = Object.entries(beat.sections).filter(([k, ms]) => ms > 0 && k in TITLES);
  let sum = entries.reduce((a, [, ms]) => a + ms, 0);
  if (!sum) return null;
  // Scale an oversized beat down instead of trusting it.
  const scale = sum > MAX_BEAT_MS ? MAX_BEAT_MS / sum : 1;
  const add = Object.fromEntries(entries.map(([k, ms]) => [k, Math.round(ms * scale)]));
  sum = Object.values(add).reduce((a, b) => a + b, 0);

  const existing = await db.proposalReadSession.findUnique({ where: { proposalId_visitorKey: { proposalId, visitorKey: beat.visitorKey } } });
  if (existing && existing.totalMs >= MAX_VISIT_MS) return existing.totalMs;
  const merged: Record<string, number> = { ...((existing?.sections as Record<string, number> | null) ?? {}) };
  for (const [k, ms] of Object.entries(add)) merged[k] = (merged[k] ?? 0) + ms;
  const row = await db.proposalReadSession.upsert({
    where: { proposalId_visitorKey: { proposalId, visitorKey: beat.visitorKey } },
    create: { proposalId, version, visitorKey: beat.visitorKey, device: beat.device, totalMs: sum, sections: merged },
    update: { totalMs: { increment: sum }, sections: merged, lastSeenAt: new Date() },
    select: { totalMs: true },
  });
  return row.totalMs;
}

export type ReadingSummary = {
  visits: number;
  totalMs: number;
  lastReadAt: Date | null;
  devices: { DESKTOP: number; MOBILE: number };
  sections: { key: string; title: string; ms: number }[];
  decision: { key: string; title: string; ms: number }[];
};

/** Everything the proposal page shows about how the client read it. */
export async function readingSummary(workspaceId: string, proposalId: string): Promise<ReadingSummary | null> {
  const rows = await db.proposalReadSession.findMany({
    where: { proposalId, proposal: { workspaceId } },
    orderBy: { lastSeenAt: "desc" },
    select: { totalMs: true, device: true, sections: true, lastSeenAt: true },
  });
  // Visits shorter than 3 seconds are a link preview or a mis-click, not reading.
  const real = rows.filter((r) => r.totalMs >= 3000);
  if (!real.length) return null;
  const perSection = new Map<string, number>();
  for (const r of real) for (const [k, ms] of Object.entries((r.sections as Record<string, number>) ?? {})) perSection.set(k, (perSection.get(k) ?? 0) + ms);
  const sections = [...perSection.entries()].map(([key, ms]) => ({ key, title: TITLES[key] ?? key, ms })).sort((a, b) => b.ms - a.ms);
  return {
    visits: real.length,
    totalMs: real.reduce((a, r) => a + r.totalMs, 0),
    lastReadAt: real[0].lastSeenAt,
    devices: { DESKTOP: real.filter((r) => r.device === "DESKTOP").length, MOBILE: real.filter((r) => r.device === "MOBILE").length },
    sections,
    decision: DECISION_SECTIONS.map((key) => ({ key, title: TITLES[key], ms: perSection.get(key) ?? 0 })),
  };
}

/** "1 min 05 s", "42 s". */
export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/**
 * Script added to the client's view of the proposal (inside the sandboxed frame). Every second it
 * notes which section is in the middle of the screen — only while the tab is visible and the reader
 * moved, scrolled or touched in the last 45 s — and posts the totals to the page around it.
 */
export function readTrackerScript() {
  return `(() => {
  const parts = () => Array.from(document.querySelectorAll("#cover, #glance, main section[id]"));
  let acc = {}, active = Date.now();
  for (const ev of ["scroll", "wheel", "mousemove", "keydown", "touchstart", "pointerdown"]) addEventListener(ev, () => { active = Date.now(); }, { passive: true });
  const flush = () => {
    if (!Object.keys(acc).length) return;
    parent.postMessage({ type: "proposal-read", sections: acc }, "*");
    acc = {};
  };
  setInterval(() => {
    if (document.visibilityState !== "visible" || Date.now() - active > 45000) return;
    const y = innerHeight * 0.4;
    const el = parts().find((p) => { const r = p.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
    if (el) acc[el.id] = (acc[el.id] || 0) + 1000;
  }, 1000);
  setInterval(flush, 10000);
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  addEventListener("pagehide", flush);
})();`;
}
