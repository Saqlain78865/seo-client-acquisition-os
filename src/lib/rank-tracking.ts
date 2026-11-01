import "server-only";
import { db } from "./db";
import { analyticsRows } from "./search-console";
import { raiseAlert } from "./site-alerts";

/**
 * Keyword rank tracking for My Websites: up to 50 chosen searches per website, with the daily
 * average position read from the site's own Search Console property. Positions are what Google
 * reports; a day without impressions is recorded as "not shown", never guessed.
 */

export const MAX_KEYWORDS = 50;
const DAY = 86400_000;
/** A fall of this many places (week against week) raises an alert. */
export const RANK_DROP_PLACES = 3;

export class RankError extends Error {}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const clean = (k: string) => k.toLowerCase().replace(/\s+/g, " ").trim();

/** Adds keywords (one per line or comma separated); duplicates are skipped. */
export async function addKeywords(workspaceId: string, websiteId: string, text: string) {
  const site = await db.website.findFirst({ where: { id: websiteId, workspaceId }, select: { id: true } });
  if (!site) throw new RankError("Website not found.");
  const wanted = [...new Set(text.split(/[\n,]/).map(clean).filter((k) => k.length >= 2 && k.length <= 120))];
  if (!wanted.length) throw new RankError("Enter at least one keyword.");
  const existing = new Set((await db.trackedKeyword.findMany({ where: { websiteId }, select: { keyword: true } })).map((k) => k.keyword));
  const fresh = wanted.filter((k) => !existing.has(k));
  if (existing.size + fresh.length > MAX_KEYWORDS) throw new RankError(`Up to ${MAX_KEYWORDS} keywords per website — ${MAX_KEYWORDS - existing.size} more can be added.`);
  if (fresh.length) await db.trackedKeyword.createMany({ data: fresh.map((keyword) => ({ workspaceId, websiteId, keyword })) });
  return fresh.length;
}

export async function removeKeyword(workspaceId: string, id: string) {
  const { count } = await db.trackedKeyword.deleteMany({ where: { id, workspaceId } });
  if (!count) throw new RankError("Keyword not found.");
}

/** RE2 pattern matching exactly one of the keywords (Search Console's includingRegex). */
export function exactAny(keywords: string[]) {
  return `^(?:${keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;
}

/**
 * Reads the last 10 days of positions for the website's keywords and stores them. Search Console
 * keeps adding fresh days, so recent days are rewritten on every run.
 */
export async function syncPositions(workspaceId: string, websiteId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const keywords = await db.trackedKeyword.findMany({ where: { websiteId, workspaceId } });
  if (!keywords.length) {
    await db.website.update({ where: { id: websiteId }, data: { keywordsSyncedAt: now } });
    return 0;
  }
  const start = ymd(new Date(now.getTime() - 10 * DAY));
  const end = ymd(new Date(now.getTime() - DAY));
  const rows = await analyticsRows(
    workspaceId,
    websiteId,
    { startDate: start, endDate: end, dimensions: ["query", "date"], dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "query", operator: "includingRegex", expression: exactAny(keywords.map((k) => k.keyword)) }] }] },
    fetchImpl,
  );
  const byKey = new Map(keywords.map((k) => [k.keyword, k.id]));
  const days: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) days.push(ymd(new Date(t)));
  const seen = new Map<string, { position: number; clicks: number; impressions: number }>();
  for (const r of rows) {
    const id = byKey.get(clean(r.keys[0] ?? ""));
    if (id && r.keys[1]) seen.set(`${id}|${r.keys[1]}`, { position: r.position, clicks: r.clicks, impressions: r.impressions });
  }
  // Days Search Console has not filled in yet (the newest one or two) are left out rather than called "not shown".
  const lastDay = rows.reduce((m, r) => (r.keys[1] && r.keys[1] > m ? r.keys[1] : m), "");
  await db.$transaction(
    keywords.flatMap((k) =>
      days
        .filter((date) => date <= (lastDay || end))
        .map((date) => {
          const v = seen.get(`${k.id}|${date}`) ?? { position: null, clicks: 0, impressions: 0 };
          return db.keywordPosition.upsert({ where: { trackedKeywordId_date: { trackedKeywordId: k.id, date } }, create: { trackedKeywordId: k.id, date, ...v }, update: v });
        }),
    ),
  );
  await db.website.update({ where: { id: websiteId }, data: { keywordsSyncedAt: now } });
  await rankDropAlerts(workspaceId, websiteId);
  return keywords.length;
}

type Point = { date: string; position: number | null };

/** Average position over the shown days of a list (null when never shown). */
export function averagePosition(points: Point[]) {
  const shown = points.filter((p) => p.position != null);
  return shown.length ? shown.reduce((s, p) => s + p.position!, 0) / shown.length : null;
}

/** This week against last week for one keyword: the latest 7 stored days against the 7 before. */
export function weekMove(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const now = averagePosition(sorted.slice(-7));
  const before = averagePosition(sorted.slice(-14, -7));
  return { now, before, change: now != null && before != null ? before - now : null };
}

async function rankDropAlerts(workspaceId: string, websiteId: string) {
  const keywords = await db.trackedKeyword.findMany({ where: { websiteId }, include: { positions: { orderBy: { date: "desc" }, take: 14 } } });
  for (const k of keywords) {
    const m = weekMove(k.positions);
    const week = k.positions[0]?.date ?? "";
    if (m.change != null && m.change <= -RANK_DROP_PLACES) {
      await raiseAlert(workspaceId, websiteId, {
        kind: "RANK_DROP",
        dedupeKey: `rank:${k.id}:${week}`,
        title: `“${k.keyword}” fell from ${m.before!.toFixed(1)} to ${m.now!.toFixed(1)}`,
        detail: "Average Google position this week against last week (Search Console).",
      });
    } else if (m.before != null && m.now == null) {
      await raiseAlert(workspaceId, websiteId, { kind: "RANK_DROP", dedupeKey: `rank:${k.id}:${week}`, title: `“${k.keyword}” is no longer shown on Google`, detail: `It averaged position ${m.before.toFixed(1)} the week before.` });
    }
  }
}

/** Keywords with their stored days (newest 30), for the website page. */
export async function trackedKeywords(workspaceId: string, websiteId: string) {
  const list = await db.trackedKeyword.findMany({ where: { websiteId, workspaceId }, orderBy: { createdAt: "asc" }, include: { positions: { orderBy: { date: "desc" }, take: 30 } } });
  return list.map((k) => {
    const points = k.positions.map((p) => ({ date: p.date, position: p.position })).reverse();
    const latest = [...k.positions].find((p) => p.position != null) ?? null;
    return { id: k.id, keyword: k.keyword, points, latest: latest ? { date: latest.date, position: latest.position! } : null, ...weekMove(points) };
  });
}
