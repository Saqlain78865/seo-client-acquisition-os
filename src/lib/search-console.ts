import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import { getCredentials } from "./integrations";
import { GoogleAuthError, accessTokenFor } from "./messaging/google-oauth";

/**
 * Google Search Console, read-only, for My Websites. Each website can only be linked to its own
 * property (its domain property or a URL prefix on its own host), so one site never shows another
 * site's data. Reports are read live from Search Console; nothing is ever written to it.
 */

const API = "https://www.googleapis.com/webmasters/v3";
const DAY = 86400_000;

export class GscError extends Error {}

export type GscSite = { siteUrl: string; permissionLevel: string };
export type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };
export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };
export type Dimension = "query" | "page" | "country" | "device" | "searchAppearance";
export const DIMENSIONS: Dimension[] = ["query", "page", "country", "device", "searchAppearance"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function token(workspaceId: string, fetchImpl: typeof fetch) {
  const c = await getCredentials<{ refreshToken: string }>(workspaceId, "SEARCH_CONSOLE");
  if (!c) throw new GscError("Connect Search Console on the Integrations page first.");
  try {
    return await accessTokenFor(workspaceId, c.secret.refreshToken, fetchImpl);
  } catch (e) {
    if (e instanceof GoogleAuthError) throw new GscError(e.message);
    throw e;
  }
}

async function call<T>(tok: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${tok}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (res.status === 401) throw new GscError("Search Console access expired or was removed. Reconnect it on the Integrations page.");
  if (res.status === 403) throw new GscError(`No access to this Search Console property${json.error?.message ? `: ${json.error.message}` : ""}.`);
  if (!res.ok) throw new GscError(`Search Console error: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return json;
}

/** Properties the connected account can read (unverified ones are left out). */
export async function listSites(workspaceId: string, fetchImpl: typeof fetch = fetch): Promise<GscSite[]> {
  const tok = await token(workspaceId, fetchImpl);
  const r = await call<{ siteEntry?: GscSite[] }>(tok, "/sites", undefined, fetchImpl);
  return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** True when a property belongs to this website: its domain property, or a URL prefix on its own host (with or without www). */
export function propertyMatches(siteUrl: string, domain: string) {
  const d = bare(domain);
  if (siteUrl.startsWith("sc-domain:")) return bare(siteUrl.slice("sc-domain:".length)) === d;
  try {
    return bare(new URL(siteUrl).hostname) === d;
  } catch {
    return false;
  }
}

/** The best property for a website: the domain property first, then https, then http prefixes. */
export function matchSite(sites: GscSite[], domain: string): string | null {
  const own = sites.filter((s) => propertyMatches(s.siteUrl, domain));
  const rank = (u: string) => (u.startsWith("sc-domain:") ? 0 : u.startsWith("https://") ? 1 : 2);
  return own.sort((a, b) => rank(a.siteUrl) - rank(b.siteUrl))[0]?.siteUrl ?? null;
}

/** Links (or unlinks) a website's own Search Console property. */
export async function linkWebsite(workspaceId: string, userId: string, websiteId: string, siteUrl: string | null, fetchImpl: typeof fetch = fetch) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId } });
  if (!w) throw new GscError("Website not found.");
  if (siteUrl) {
    if (!propertyMatches(siteUrl, w.domain)) throw new GscError(`${siteUrl} is not a property of ${w.domain}. Only this website's own property can be linked.`);
    const sites = await listSites(workspaceId, fetchImpl);
    if (!sites.some((s) => s.siteUrl === siteUrl)) throw new GscError("The connected Google account cannot see that Search Console property.");
  }
  await db.website.update({ where: { id: websiteId }, data: { gscSiteUrl: siteUrl } });
  await logActivity({ workspaceId, userId, type: "gsc.linked", message: siteUrl ? `Search Console property linked to ${w.domain}: ${siteUrl}` : `Search Console unlinked from ${w.domain}` });
}

// ───────────────────────────── Explorer ─────────────────────────────

export function totals(rows: { clicks: number; impressions: number; position: number }[]): GscTotals {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  // Average position weighted by impressions, as Search Console shows it.
  const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

export type ExploreInput = {
  /** Last N days, up to yesterday (fresh data included, as in Search Console). */
  days?: number;
  /** Last 24 hours, hour by hour (Search Console's hourly data, which may still be filling in). */
  hours?: 24;
  start?: string;
  end?: string;
  compare?: boolean;
  /** An explicit comparison period (e.g. the previous calendar month); otherwise the same length just before. */
  previous?: { start: string; end: string };
  dimension: Dimension;
  /** Text search within the shown dimension (queries or pages containing it). */
  search?: string;
  /** Exact filters, e.g. clicking a page to see its queries. */
  filters?: Partial<Record<"query" | "page" | "country" | "device", string>>;
  rowLimit?: number;
};

export type ExploreRow = GscRow & { previous: GscRow | null };
export type ExploreResult = {
  siteUrl: string;
  range: { start: string; end: string };
  previousRange: { start: string; end: string } | null;
  totals: GscTotals;
  previousTotals: GscTotals | null;
  series: { date: string; clicks: number; impressions: number; ctr: number; position: number }[];
  previousSeries: { date: string; clicks: number; impressions: number }[];
  rows: ExploreRow[];
};

export function rangeFor(input: Pick<ExploreInput, "days" | "start" | "end">, now = new Date()) {
  if (input.start && input.end && /^\d{4}-\d{2}-\d{2}$/.test(input.start) && /^\d{4}-\d{2}-\d{2}$/.test(input.end) && input.start <= input.end) return { start: input.start, end: input.end };
  const end = new Date(now.getTime() - DAY);
  const days = Math.min(Math.max(input.days ?? 28, 1), 480);
  return { start: ymd(new Date(end.getTime() - (days - 1) * DAY)), end: ymd(end) };
}

/** The same number of days just before a range. */
export function previousOf(r: { start: string; end: string }) {
  const s = Date.parse(`${r.start}T00:00:00Z`);
  const e = Date.parse(`${r.end}T00:00:00Z`);
  const len = e - s + DAY;
  return { start: ymd(new Date(s - len)), end: ymd(new Date(s - DAY)) };
}

function filterGroups(input: ExploreInput) {
  const filters: { dimension: string; operator: string; expression: string }[] = [];
  for (const [dimension, expression] of Object.entries(input.filters ?? {})) if (expression) filters.push({ dimension, operator: "equals", expression });
  const q = input.search?.trim();
  if (q && (input.dimension === "query" || input.dimension === "page")) filters.push({ dimension: input.dimension, operator: "contains", expression: q });
  return filters.length ? [{ groupType: "and", filters }] : undefined;
}

/** A Search Console report for one website: totals, a daily chart and a table, optionally against the previous period. */
type ApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

/** Adds up rows that share a key (clicks and impressions summed, position weighted by impressions). */
function aggregate(rows: { key: string; clicks: number; impressions: number; position: number }[]): GscRow[] {
  const by = new Map<string, { clicks: number; impressions: number; pos: number }>();
  for (const r of rows) {
    const a = by.get(r.key) ?? { clicks: 0, impressions: 0, pos: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.pos += r.position * r.impressions;
    by.set(r.key, a);
  }
  return [...by].map(([key, a]) => ({ key, clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? a.clicks / a.impressions : 0, position: a.impressions ? a.pos / a.impressions : 0 })).sort((x, y) => y.clicks - x.clicks || y.impressions - x.impressions);
}

/**
 * The last 24 hours from Search Console's hourly data, against the 24 hours before. Hours are in
 * Pacific Time, as Search Console reports them; the newest hours may still be filling in.
 */
async function exploreHourly(siteUrl: string, tok: string, input: ExploreInput, fetchImpl: typeof fetch, now = new Date()): Promise<ExploreResult> {
  const groups = filterGroups(input);
  const dim = input.dimension === "searchAppearance" ? "query" : input.dimension;
  const q = (dimensions: string[]) =>
    call<{ rows?: ApiRow[] }>(
      tok,
      `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      { startDate: ymd(new Date(now.getTime() - 3 * DAY)), endDate: ymd(now), dimensions, dataState: "HOURLY_ALL", rowLimit: 25000, ...(groups ? { dimensionFilterGroups: groups } : {}) },
      fetchImpl,
    ).then((x) => x.rows ?? []);
  const [hourRows, dimRows] = await Promise.all([q(["hour"]), q(["hour", dim])]);
  const at = (k: string | undefined) => Date.parse(k ?? "");
  const latest = Math.max(...hourRows.map((r) => at(r.keys?.[0])).filter(Number.isFinite), 0);
  const inCurrent = (t: number) => t > latest - DAY && t <= latest;
  const inPrevious = (t: number) => t > latest - 2 * DAY && t <= latest - DAY;
  const point = (r: ApiRow) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
  const series = hourRows.filter((r) => inCurrent(at(r.keys?.[0]))).map(point).sort((a, b) => at(a.date) - at(b.date));
  const prevSeries = hourRows.filter((r) => inPrevious(at(r.keys?.[0]))).map(point).sort((a, b) => at(a.date) - at(b.date));
  const flat = (keep: (t: number) => boolean) => dimRows.filter((r) => keep(at(r.keys?.[0]))).map((r) => ({ key: r.keys?.[1] ?? "", clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const rows = aggregate(flat(inCurrent)).slice(0, Math.min(Math.max(input.rowLimit ?? 1000, 10), 5000));
  const before = new Map(aggregate(flat(inPrevious)).map((r) => [r.key, r]));
  const span = (list: { date: string }[]) => (list.length ? { start: list[0].date, end: list[list.length - 1].date } : { start: "", end: "" });
  return {
    siteUrl,
    range: span(series),
    previousRange: input.compare ? span(prevSeries) : null,
    totals: totals(series),
    previousTotals: input.compare ? totals(prevSeries) : null,
    series,
    previousSeries: input.compare ? prevSeries.map((p) => ({ date: p.date, clicks: p.clicks, impressions: p.impressions })) : [],
    rows: rows.map((r) => ({ ...r, previous: input.compare ? (before.get(r.key) ?? null) : null })),
  };
}

export async function explore(workspaceId: string, websiteId: string, input: ExploreInput, fetchImpl: typeof fetch = fetch): Promise<ExploreResult> {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId }, select: { gscSiteUrl: true, domain: true } });
  if (!w) throw new GscError("Website not found.");
  if (!w.gscSiteUrl) throw new GscError("Link this website's Search Console property first.");
  // Defence in depth: a property that is not this website's own is never read.
  if (!propertyMatches(w.gscSiteUrl, w.domain)) throw new GscError("The linked property does not belong to this website. Link its own property again.");
  const tok = await token(workspaceId, fetchImpl);
  if (input.hours === 24) return exploreHourly(w.gscSiteUrl, tok, input, fetchImpl);
  const range = rangeFor(input);
  const previousRange = input.previous ?? (input.compare ? previousOf(range) : null);
  const groups = filterGroups(input);
  const dims = input.dimension === "searchAppearance" ? ["searchAppearance"] : [input.dimension];
  const q = (r: { start: string; end: string }, dimensions: string[], rowLimit: number) =>
    call<{ rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(
      tok,
      `/sites/${encodeURIComponent(w.gscSiteUrl!)}/searchAnalytics/query`,
      // "all" includes the fresh, not yet final days, as the Search Console reports do.
      { startDate: r.start, endDate: r.end, dimensions, rowLimit, dataState: "all", ...(groups && input.dimension !== "searchAppearance" ? { dimensionFilterGroups: groups } : {}) },
      fetchImpl,
    ).then((x) => (x.rows ?? []).map((row) => ({ key: row.keys?.[0] ?? "", clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })));
  const limit = Math.min(Math.max(input.rowLimit ?? 1000, 10), 5000);
  const [series, rows, prevSeries, prevRows] = await Promise.all([
    q(range, ["date"], 1000),
    q(range, dims, limit),
    previousRange ? q(previousRange, ["date"], 1000) : Promise.resolve([] as GscRow[]),
    previousRange ? q(previousRange, dims, 5000) : Promise.resolve([] as GscRow[]),
  ]);
  const before = new Map(prevRows.map((r) => [r.key, r]));
  return {
    siteUrl: w.gscSiteUrl,
    range,
    previousRange,
    totals: totals(series),
    previousTotals: previousRange ? totals(prevSeries) : null,
    series: series.map((r) => ({ date: r.key, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    previousSeries: prevSeries.map((r) => ({ date: r.key, clicks: r.clicks, impressions: r.impressions })),
    rows: rows.map((r) => ({ ...r, previous: before.get(r.key) ?? null })),
  };
}

/** One calendar month (YYYY-MM) against the month before, for the website's monthly report. */
export async function monthReport(workspaceId: string, websiteId: string, month: string, fetchImpl: typeof fetch = fetch) {
  const [y, m] = month.split("-").map(Number);
  const range = { start: `${month}-01`, end: ymd(new Date(Date.UTC(y, m, 0))) };
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prev = { start: ymd(prevStart), end: ymd(new Date(Date.UTC(y, m - 1, 0))) };
  const run = (dimension: Dimension) => explore(workspaceId, websiteId, { ...range, previous: prev, dimension, rowLimit: 1000 }, fetchImpl);
  const [queries, pages] = await Promise.all([run("query"), run("page")]);
  return { queries, pages };
}
