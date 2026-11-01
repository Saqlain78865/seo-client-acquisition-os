import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import { logger } from "./log";
import { getCredentials } from "./integrations";
import { GoogleAuthError, accessTokenFor } from "./messaging/google-oauth";

/**
 * Google Search Console, read-only: the properties the connected Google account can see, daily
 * totals for each linked website (synced every day), and month-against-month results for the
 * client report. Nothing is ever written to Search Console.
 */

const API = "https://www.googleapis.com/webmasters/v3";
const DAY = 86400_000;
const log = logger("search-console");

export class GscError extends Error {}

export type GscSite = { siteUrl: string; permissionLevel: string };
export type GscTotals = { clicks: number; impressions: number; ctr: number; position: number };
export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };

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

/** The property that belongs to a website: the domain property first, then its https/http URL prefixes. */
export function matchSite(sites: GscSite[], domain: string): string | null {
  const d = domain.replace(/^www\./, "").toLowerCase();
  const wanted = [`sc-domain:${d}`, `https://www.${d}/`, `https://${d}/`, `http://www.${d}/`, `http://${d}/`];
  for (const w of wanted) if (sites.some((s) => s.siteUrl.toLowerCase() === w)) return sites.find((s) => s.siteUrl.toLowerCase() === w)!.siteUrl;
  return null;
}

async function searchAnalytics(tok: string, siteUrl: string, body: Record<string, unknown>, fetchImpl: typeof fetch) {
  const r = await call<{ rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(tok, `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, body, fetchImpl);
  return (r.rows ?? []).map((x) => ({ key: x.keys?.[0] ?? "", clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
}

/** Links a property to the website; it must be one the connected account can read. */
export async function linkSite(workspaceId: string, userId: string, prospectId: string, siteUrl: string | null, fetchImpl: typeof fetch = fetch) {
  const prospect = await db.prospect.findFirst({ where: { id: prospectId, workspaceId } });
  if (!prospect) throw new GscError("Prospect not found.");
  if (siteUrl) {
    const sites = await listSites(workspaceId, fetchImpl);
    if (!sites.some((s) => s.siteUrl === siteUrl)) throw new GscError("This Google account cannot see that Search Console property.");
  }
  await db.prospect.update({ where: { id: prospectId }, data: { gscSiteUrl: siteUrl, gscSyncedAt: null } });
  if (!siteUrl) await db.gscDaily.deleteMany({ where: { prospectId } });
  await logActivity({ workspaceId, prospectId, userId, type: "gsc.linked", message: siteUrl ? `Search Console property linked: ${siteUrl}` : "Search Console property unlinked" });
  return siteUrl ? syncProspect(workspaceId, prospectId, fetchImpl) : 0;
}

/** Daily totals: the last 16 months on the first sync, then the last 10 days (Google revises recent days). */
export async function syncProspect(workspaceId: string, prospectId: string, fetchImpl: typeof fetch = fetch) {
  const p = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, select: { gscSiteUrl: true, gscSyncedAt: true } });
  if (!p?.gscSiteUrl) throw new GscError("Link a Search Console property first.");
  const tok = await token(workspaceId, fetchImpl);
  const end = new Date(Date.now() - DAY);
  const start = new Date(end.getTime() - (p.gscSyncedAt ? 10 : 480) * DAY);
  const rows = (await searchAnalytics(tok, p.gscSiteUrl, { startDate: ymd(start), endDate: ymd(end), dimensions: ["date"], rowLimit: 25000 }, fetchImpl)).filter((r) => r.key >= ymd(start) && r.key <= ymd(end));
  await db.$transaction([
    db.gscDaily.deleteMany({ where: { prospectId, date: { gte: ymd(start), lte: ymd(end) } } }),
    db.gscDaily.createMany({ data: rows.map((r) => ({ workspaceId, prospectId, siteUrl: p.gscSiteUrl!, date: r.key, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position })) }),
    db.prospect.update({ where: { id: prospectId }, data: { gscSyncedAt: new Date() } }),
  ]);
  return rows.length;
}

/** Called by the in-app timer: each linked website is synced about once a day. */
export async function runDailySync(now = new Date()) {
  const due = await db.prospect.findMany({
    where: { gscSiteUrl: { not: null }, OR: [{ gscSyncedAt: null }, { gscSyncedAt: { lt: new Date(now.getTime() - 20 * 3600_000) } }] },
    select: { id: true, workspaceId: true },
    take: 20,
  });
  for (const p of due) {
    await syncProspect(p.workspaceId, p.id).catch((e) => log.warn("sync failed", { prospectId: p.id, reason: (e as Error).message }));
  }
  return due.length;
}

// ───────────────────────────── Reporting ─────────────────────────────

export function totals(rows: { clicks: number; impressions: number; position: number }[]): GscTotals {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  // Average position weighted by impressions, as Search Console shows it.
  const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = ymd(new Date(Date.UTC(y, m, 0)));
  return { start, end };
};
const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export type MonthResults = {
  siteUrl: string;
  current: GscTotals;
  previous: GscTotals;
  daily: { date: string; clicks: number; impressions: number }[];
  queries: (GscRow & { previousClicks: number; previousPosition: number | null })[];
  pages: (GscRow & { previousClicks: number })[];
  detailError: string | null;
};

/**
 * One month against the month before: totals from the synced daily data, and the top searches and
 * pages read live from Search Console (left out with a note when it cannot be reached).
 */
export async function monthResults(workspaceId: string, prospectId: string, month: string, fetchImpl: typeof fetch = fetch): Promise<MonthResults | null> {
  const p = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, select: { gscSiteUrl: true } });
  if (!p?.gscSiteUrl) return null;
  const cur = monthRange(month);
  const prev = monthRange(prevMonth(month));
  const [curRows, prevRows] = await Promise.all([
    db.gscDaily.findMany({ where: { prospectId, date: { gte: cur.start, lte: cur.end } }, orderBy: { date: "asc" } }),
    db.gscDaily.findMany({ where: { prospectId, date: { gte: prev.start, lte: prev.end } } }),
  ]);
  let queries: MonthResults["queries"] = [];
  let pages: MonthResults["pages"] = [];
  let detailError: string | null = null;
  try {
    const tok = await token(workspaceId, fetchImpl);
    const q = (range: { start: string; end: string }, dim: "query" | "page") => searchAnalytics(tok, p.gscSiteUrl!, { startDate: range.start, endDate: range.end, dimensions: [dim], rowLimit: 250 }, fetchImpl);
    const [qc, qp, pc, pp] = await Promise.all([q(cur, "query"), q(prev, "query"), q(cur, "page"), q(prev, "page")]);
    const before = new Map(qp.map((r) => [r.key, r]));
    queries = qc.slice(0, 15).map((r) => ({ ...r, previousClicks: before.get(r.key)?.clicks ?? 0, previousPosition: before.get(r.key)?.position ?? null }));
    const pagesBefore = new Map(pp.map((r) => [r.key, r]));
    pages = pc.slice(0, 10).map((r) => ({ ...r, previousClicks: pagesBefore.get(r.key)?.clicks ?? 0 }));
  } catch (e) {
    detailError = e instanceof GscError ? e.message : "Search Console could not be reached for the search and page details.";
  }
  return { siteUrl: p.gscSiteUrl, current: totals(curRows), previous: totals(prevRows), daily: curRows.map((r) => ({ date: r.date, clicks: r.clicks, impressions: r.impressions })), queries, pages, detailError };
}
