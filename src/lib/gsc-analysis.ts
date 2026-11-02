import "server-only";
import { analyticsRows } from "./search-console";

/**
 * Two Search Console analyses for My Websites, read live from the site's own property:
 *  - keyword cannibalization: searches where two or more of the site's pages share the impressions;
 *  - content decay: pages whose clicks have fallen month after month (pages to refresh).
 */

const DAY = 86400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type CannibalPage = { page: string; clicks: number; impressions: number; position: number; share: number };
export type Cannibalization = { query: string; impressions: number; clicks: number; pages: CannibalPage[] };

/** Groups query × page rows: a search counts when 2+ pages each get at least 10% of its impressions. */
export function findCannibalization(rows: { keys: string[]; clicks: number; impressions: number; position: number }[], minImpressions = 50): Cannibalization[] {
  const byQuery = new Map<string, { page: string; clicks: number; impressions: number; position: number }[]>();
  for (const r of rows) {
    const [query, page] = r.keys;
    if (!query || !page) continue;
    const list = byQuery.get(query) ?? [];
    list.push({ page: page.replace(/#.*$/, ""), clicks: r.clicks, impressions: r.impressions, position: r.position });
    byQuery.set(query, list);
  }
  const out: Cannibalization[] = [];
  for (const [query, list] of byQuery) {
    // The same page with and without a #fragment is one page.
    const merged = new Map<string, { page: string; clicks: number; impressions: number; position: number }>();
    for (const p of list) {
      const m = merged.get(p.page);
      if (!m) merged.set(p.page, { ...p });
      else {
        m.position = (m.position * m.impressions + p.position * p.impressions) / Math.max(m.impressions + p.impressions, 1);
        m.clicks += p.clicks;
        m.impressions += p.impressions;
      }
    }
    const pages = [...merged.values()];
    const impressions = pages.reduce((s, p) => s + p.impressions, 0);
    if (impressions < minImpressions) continue;
    const competing = pages.filter((p) => p.impressions >= 10 && p.impressions / impressions >= 0.1).sort((a, b) => b.impressions - a.impressions);
    if (competing.length < 2) continue;
    out.push({ query, impressions, clicks: pages.reduce((s, p) => s + p.clicks, 0), pages: competing.slice(0, 5).map((p) => ({ ...p, share: p.impressions / impressions })) });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, 30);
}

export async function cannibalization(workspaceId: string, websiteId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const end = new Date(now.getTime() - 2 * DAY);
  const rows = await analyticsRows(workspaceId, websiteId, { startDate: ymd(new Date(end.getTime() - 89 * DAY)), endDate: ymd(end), dimensions: ["query", "page"] }, fetchImpl);
  return findCannibalization(rows);
}

export type DecayingPage = { page: string; months: { month: string; clicks: number }[]; peak: number; latest: number; lost: number; drop: number };

/** The last `count` complete calendar months, oldest first. */
export function lastMonths(now: Date, count: number) {
  const out: { month: string; start: string; end: string }[] = [];
  for (let i = count; i >= 1; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    out.push({ month: ymd(start).slice(0, 7), start: ymd(start), end: ymd(end) });
  }
  return out;
}

/** Pages that had real traffic and lost at least 30% of it, still falling in the latest month. */
export function findDecay(series: Map<string, number[]>, months: string[], minPeak = 20): DecayingPage[] {
  const out: DecayingPage[] = [];
  for (const [page, clicks] of series) {
    const peakAt = clicks.reduce((best, c, i) => (c > clicks[best] ? i : best), 0);
    const peak = clicks[peakAt];
    const latest = clicks[clicks.length - 1];
    if (peak < minPeak || peakAt === clicks.length - 1) continue;
    const drop = (peak - latest) / peak;
    const stillFalling = latest <= clicks[clicks.length - 2];
    if (drop < 0.3 || !stillFalling) continue;
    out.push({ page, months: months.map((month, i) => ({ month, clicks: clicks[i] })), peak, latest, lost: peak - latest, drop });
  }
  return out.sort((a, b) => b.lost - a.lost).slice(0, 25);
}

export async function contentDecay(workspaceId: string, websiteId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const months = lastMonths(now, 4);
  const results = await Promise.all(months.map((m) => analyticsRows(workspaceId, websiteId, { startDate: m.start, endDate: m.end, dimensions: ["page"] }, fetchImpl)));
  const series = new Map<string, number[]>();
  results.forEach((rows, i) => {
    for (const r of rows) {
      const page = (r.keys[0] ?? "").replace(/#.*$/, "");
      const list = series.get(page) ?? months.map(() => 0);
      list[i] += r.clicks;
      series.set(page, list);
    }
  });
  return findDecay(series, months.map((m) => m.month));
}
