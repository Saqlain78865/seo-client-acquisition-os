import "server-only";
import { db } from "./db";
import { logger } from "./log";
import { notify } from "./notifications";
import { safeFetch } from "./crawler/safe-fetch";
import { runnerOptions } from "./audit/runner";
import { analyticsRows } from "./search-console";

/**
 * Alerts for My Websites: the site is down, a page has gone, traffic dropped suddenly, a tracked
 * keyword fell. Each problem is raised once (in the app's notifications) and closes itself when
 * the site recovers. Every alert comes from a real check; nothing is estimated.
 */

export type AlertKind = "TRAFFIC_DROP" | "PAGE_GONE" | "SITE_DOWN" | "RANK_DROP";
export const ALERT_LABELS: Record<AlertKind, string> = { TRAFFIC_DROP: "Traffic drop", PAGE_GONE: "Page gone", SITE_DOWN: "Site down", RANK_DROP: "Keyword fell" };

const DAY = 86400_000;
/** Failed checks in a row before the site is called down (one failure can be a network blip). */
const DOWN_AFTER = 2;
/** Clicks over 7 days against the 7 before: a fall of this share, from at least MIN_CLICKS, is an alert. */
export const TRAFFIC_DROP = 0.4;
const MIN_CLICKS = 20;
const log = logger("site-alerts");
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Raises an alert once per dedupe key; returns false when it was already raised. */
export async function raiseAlert(workspaceId: string, websiteId: string, a: { kind: AlertKind; dedupeKey: string; title: string; detail?: string; url?: string }) {
  const exists = await db.siteAlert.findUnique({ where: { websiteId_dedupeKey: { websiteId, dedupeKey: a.dedupeKey } }, select: { id: true } });
  if (exists) return false;
  const site = await db.website.findUnique({ where: { id: websiteId }, select: { name: true } });
  await db.siteAlert.create({ data: { workspaceId, websiteId, kind: a.kind, dedupeKey: a.dedupeKey, title: a.title.slice(0, 300), detail: a.detail?.slice(0, 1000), url: a.url?.slice(0, 1000) } });
  await notify({ workspaceId, title: `${site?.name ?? "Website"}: ${a.title}`, body: a.detail, link: `/websites/${websiteId}#alerts` });
  return true;
}

export async function resolveAlert(workspaceId: string, id: string) {
  const { count } = await db.siteAlert.updateMany({ where: { id, workspaceId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  return count > 0;
}

/** Opens the home page; a server error, a timeout or no connection counts as a failure. */
export async function checkUptime(workspaceId: string, websiteId: string, now = new Date()) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId } });
  if (!w) return null;
  let problem: string | null = null;
  try {
    const r = await safeFetch(w.url, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks, acceptBody: () => false, timeoutMs: 30_000, retries: 1 });
    if (r.status >= 500) problem = `The home page answered with HTTP ${r.status}.`;
  } catch (e) {
    problem = `The home page did not answer: ${(e as Error).message}`;
  }
  const failures = problem ? w.siteFailures + 1 : 0;
  const status = problem ? (failures >= DOWN_AFTER ? "DOWN" : (w.siteStatus ?? "UP")) : "UP";
  await db.website.update({ where: { id: w.id }, data: { siteStatus: status, siteCheckedAt: now, siteFailures: failures } });
  if (status === "DOWN" && w.siteStatus !== "DOWN") {
    await raiseAlert(workspaceId, w.id, { kind: "SITE_DOWN", dedupeKey: `down:${now.toISOString()}`, title: `${w.domain} is down`, detail: problem ?? undefined, url: w.url });
  }
  if (status === "UP" && w.siteStatus === "DOWN") {
    await db.siteAlert.updateMany({ where: { websiteId: w.id, kind: "SITE_DOWN", resolvedAt: null }, data: { resolvedAt: now } });
    await notify({ workspaceId, title: `${w.name}: ${w.domain} is back up`, link: `/websites/${w.id}#alerts` });
  }
  return status;
}

/** Monday of the week a day falls in, so a drop is raised once a week at most. */
const weekOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return ymd(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY));
};

/** Clicks of the last 7 complete days against the 7 before, from Search Console. */
export async function checkTraffic(workspaceId: string, websiteId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  // The newest day or two are still filling in, so the window ends three days ago.
  const end = new Date(now.getTime() - 3 * DAY);
  const rows = await analyticsRows(workspaceId, websiteId, { startDate: ymd(new Date(end.getTime() - 13 * DAY)), endDate: ymd(end), dimensions: ["date"] }, fetchImpl);
  const split = ymd(new Date(end.getTime() - 6 * DAY));
  const sum = (keep: (d: string) => boolean) => rows.filter((r) => keep(r.keys[0] ?? "")).reduce((s, r) => s + r.clicks, 0);
  const recent = sum((d) => d >= split);
  const before = sum((d) => d < split);
  await db.website.update({ where: { id: websiteId }, data: { trafficCheckedAt: now } });
  const drop = before > 0 ? (before - recent) / before : 0;
  if (before >= MIN_CLICKS && drop >= TRAFFIC_DROP) {
    await raiseAlert(workspaceId, websiteId, {
      kind: "TRAFFIC_DROP",
      dedupeKey: `traffic:${weekOf(ymd(end))}`,
      title: `Clicks from Google fell ${Math.round(drop * 100)}% (${before} → ${recent})`,
      detail: `7 days to ${ymd(end)} against the 7 days before, from Search Console.`,
    });
  }
  return { recent, before, drop };
}

/** Called by the weekly change check: pages that now return 404/410 or an error. */
export async function pageGoneAlerts(workspaceId: string, websiteId: string, gone: { url: string; status: string | null }[]) {
  for (const g of gone.slice(0, 10)) {
    await raiseAlert(workspaceId, websiteId, { kind: "PAGE_GONE", dedupeKey: `gone:${g.url}:${g.status ?? ""}`, title: `A page returns ${g.status ?? "an error"}`, detail: g.url, url: g.url });
  }
}

/**
 * The monitoring tick (every 15 minutes): uptime for every website, and once a day the Search
 * Console checks (keyword positions, traffic drop) for websites with a linked property.
 */
export async function runSiteMonitoring(now = new Date()) {
  const { syncPositions } = await import("./rank-tracking");
  const uptimeDue = await db.website.findMany({ where: { OR: [{ siteCheckedAt: null }, { siteCheckedAt: { lt: new Date(now.getTime() - 14 * 60_000) } }] }, select: { id: true, workspaceId: true }, take: 10 });
  for (const w of uptimeDue) await checkUptime(w.workspaceId, w.id, now).catch((e) => log.warn("uptime check failed", { websiteId: w.id, reason: (e as Error).message }));

  const connected = new Set((await db.integrationConnection.findMany({ where: { provider: "SEARCH_CONSOLE", status: "CONNECTED", encryptedSecret: { not: null } }, select: { workspaceId: true } })).map((c) => c.workspaceId));
  if (!connected.size) return;
  const stale = new Date(now.getTime() - 20 * 3600_000);
  const gscDue = await db.website.findMany({
    where: { gscSiteUrl: { not: null }, workspaceId: { in: [...connected] }, OR: [{ trafficCheckedAt: null }, { trafficCheckedAt: { lt: stale } }, { keywordsSyncedAt: null, keywords: { some: {} } }, { keywordsSyncedAt: { lt: stale } }] },
    select: { id: true, workspaceId: true },
    take: 3,
  });
  for (const w of gscDue) {
    await syncPositions(w.workspaceId, w.id, fetch, now).catch(async (e) => {
      log.warn("keyword sync failed", { websiteId: w.id, reason: (e as Error).message });
      await db.website.update({ where: { id: w.id }, data: { keywordsSyncedAt: now } });
    });
    await checkTraffic(w.workspaceId, w.id, fetch, now).catch(async (e) => {
      log.warn("traffic check failed", { websiteId: w.id, reason: (e as Error).message });
      await db.website.update({ where: { id: w.id }, data: { trafficCheckedAt: now } });
    });
  }
}

export async function openAlerts(workspaceId: string, websiteId?: string) {
  return db.siteAlert.findMany({ where: { workspaceId, ...(websiteId ? { websiteId } : {}) }, orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 50, include: { website: { select: { name: true } } } });
}
