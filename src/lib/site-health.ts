import "server-only";
import { db } from "./db";
import { logger } from "./log";
import { notify } from "./notifications";
import { runnerOptions } from "./audit/runner";
import { safeFetch } from "./crawler/safe-fetch";
import { discoverSitemaps, fetchRobots } from "./crawler/robots-sitemap";
import { inspectUrls, type Inspection } from "./search-console";
import { raiseAlert } from "./site-alerts";

/**
 * Site health for My Websites: Google's index status of the pages (monthly, Search Console URL
 * Inspection) and the files that control crawling (daily: robots.txt, the home page's noindex,
 * the sitemaps). Problems raise alerts; they close by themselves once fixed.
 */

const DAY = 86400_000;
const INDEX_LIMIT = 100;
const log = logger("site-health");

/** Raises an alert for a problem unless one is still open; the key names the problem. */
async function openProblem(workspaceId: string, websiteId: string, key: string, a: { kind: "INDEXING" | "ROBOTS" | "SITEMAP"; title: string; detail?: string; url?: string }) {
  const open = await db.siteAlert.findFirst({ where: { websiteId, dedupeKey: { startsWith: `${key}@` }, resolvedAt: null }, select: { id: true } });
  if (open) return false;
  return raiseAlert(workspaceId, websiteId, { ...a, dedupeKey: `${key}@${Date.now()}` });
}

async function closeProblem(websiteId: string, key: string) {
  const { count } = await db.siteAlert.updateMany({ where: { websiteId, dedupeKey: { startsWith: `${key}@` }, resolvedAt: null }, data: { resolvedAt: new Date() } });
  return count;
}

// ── robots.txt and sitemap ──

const NOINDEX_META = /<meta[^>]+name=["']?(?:robots|googlebot)["']?[^>]*content=["'][^"']*noindex/i;
const NOINDEX_META_REV = /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]*name=["']?(?:robots|googlebot)/i;

export async function checkRobotsAndSitemap(workspaceId: string, websiteId: string, now = new Date()) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId } });
  if (!w) return null;
  const guard = { allowPrivateNetworks: runnerOptions.allowPrivateNetworks };
  const origin = new URL(w.url).origin;
  const robots = await fetchRobots(origin, guard);
  const found: string[] = [];

  // 1. robots.txt blocking the whole site.
  if (robots.blocksEverything) {
    found.push("robots");
    await openProblem(workspaceId, w.id, "robots-block", { kind: "ROBOTS", title: "robots.txt blocks Google from the whole website", detail: "“Disallow: /” applies to all crawlers. Google will stop crawling and the site can drop out of search.", url: robots.url });
  } else if (robots.error) {
    found.push("robots");
    await openProblem(workspaceId, w.id, "robots-block", { kind: "ROBOTS", title: "robots.txt returns a server error", detail: `${robots.error}. Google treats the site as blocked while this lasts.`, url: robots.url });
  } else await closeProblem(w.id, "robots-block");

  // 2. The home page told not to be indexed.
  const home = await safeFetch(w.url, { ...guard, timeoutMs: 30_000, retries: 1 }).catch(() => null);
  const headerNoindex = /noindex/i.test(home?.headers["x-robots-tag"] ?? "");
  const metaNoindex = !!home?.body && (NOINDEX_META.test(home.body) || NOINDEX_META_REV.test(home.body));
  if (home && home.status < 400 && (headerNoindex || metaNoindex)) {
    found.push("noindex");
    await openProblem(workspaceId, w.id, "home-noindex", { kind: "ROBOTS", title: "The home page is set to noindex", detail: headerNoindex ? "The X-Robots-Tag header says noindex." : "A robots meta tag says noindex. Google will remove the page from search.", url: w.url });
  } else if (home) await closeProblem(w.id, "home-noindex");

  // 3. Sitemaps: none working, or far fewer URLs than last time.
  const maps = await discoverSitemaps(origin, robots.sitemaps, guard, 5000);
  const working = maps.checked.filter((c) => (c.kind === "urlset" || c.kind === "index") && c.status != null && c.status < 400);
  const count = maps.urls.length;
  if (!working.length || count === 0) {
    found.push("sitemap");
    const tried = maps.checked.map((c) => `${c.url.replace(origin, "")} (${c.status ?? c.error ?? "no answer"})`).join(", ");
    await openProblem(workspaceId, w.id, "sitemap-broken", { kind: "SITEMAP", title: "No working sitemap found", detail: `Checked: ${tried || "sitemap.xml"}. A sitemap helps Google find new pages.` });
  } else await closeProblem(w.id, "sitemap-broken");
  if (w.sitemapUrlCount != null && w.sitemapUrlCount >= 20 && count > 0 && count < w.sitemapUrlCount * 0.5) {
    found.push("sitemap-drop");
    await raiseAlert(workspaceId, w.id, { kind: "SITEMAP", dedupeKey: `sitemap-drop:${now.toISOString().slice(0, 10)}`, title: `The sitemap lost ${w.sitemapUrlCount - count} URLs (${w.sitemapUrlCount} → ${count})`, detail: "Pages may have been removed or the sitemap plugin changed." });
  }

  // 4. robots.txt edited: worth a look, not a problem by itself.
  const body = robots.found ? (robots.body ?? "").slice(0, 20_000) : null;
  if (w.robotsCheckedAt && (w.robotsBody ?? null) !== body && !robots.error) {
    await notify({ workspaceId, title: `${w.name}: robots.txt was changed`, body: body ? body.slice(0, 300) : "robots.txt was removed.", link: `/websites/${w.id}#health` });
  }
  await db.website.update({ where: { id: w.id }, data: { robotsCheckedAt: now, robotsBody: robots.error ? w.robotsBody : body, sitemapUrlCount: count || w.sitemapUrlCount } });
  return { problems: found, sitemapUrls: count, sitemaps: working.map((c) => c.url), robotsFound: robots.found };
}

// ── Google indexing ──

const indexed = (v: string) => v === "PASS";

/** Pages to inspect: those seen by the weekly check, else the sitemap, the home page first. */
async function pagesToInspect(w: { id: string; url: string }) {
  const snaps = await db.pageSnapshot.findMany({ where: { websiteId: w.id, status: { lt: 300 } }, select: { url: true }, take: INDEX_LIMIT * 2 });
  let urls = snaps.map((s) => s.url);
  if (urls.length < 5) {
    const origin = new URL(w.url).origin;
    const robots = await fetchRobots(origin, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks });
    urls = [...urls, ...(await discoverSitemaps(origin, robots.sitemaps, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks }, INDEX_LIMIT * 2)).urls];
  }
  return [...new Set([w.url, ...urls])].slice(0, INDEX_LIMIT);
}

export async function runIndexCheck(workspaceId: string, websiteId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId } });
  if (!w) return null;
  const urls = await pagesToInspect(w);
  const before = new Map((await db.indexStatus.findMany({ where: { websiteId } })).map((s) => [s.url, s]));
  const results = await inspectUrls(workspaceId, websiteId, urls, fetchImpl);
  const dropped: string[] = [];
  let errors = 0;
  for (const [url, r] of results) {
    if ("error" in r) {
      errors++;
      continue;
    }
    const data = { ...pick(r), lastCrawlTime: r.lastCrawlTime ? new Date(r.lastCrawlTime) : null, checkedAt: now };
    await db.indexStatus.upsert({ where: { websiteId_url: { websiteId, url } }, create: { workspaceId, websiteId, url, ...data }, update: data });
    const was = before.get(url);
    if (was && indexed(was.verdict) && !indexed(r.verdict)) dropped.push(url);
  }
  await db.website.update({ where: { id: websiteId }, data: { indexCheckedAt: now } });
  const month = now.toISOString().slice(0, 7);
  if (dropped.length) {
    await raiseAlert(workspaceId, websiteId, {
      kind: "INDEXING",
      dedupeKey: `deindexed:${month}`,
      title: `${dropped.length} page${dropped.length === 1 ? "" : "s"} dropped out of Google's index`,
      detail: dropped.slice(0, 5).join(" · "),
      url: dropped[0],
    });
  }
  const homeNow = results.get(w.url);
  if (homeNow && !("error" in homeNow) && !indexed(homeNow.verdict)) {
    await raiseAlert(workspaceId, websiteId, { kind: "INDEXING", dedupeKey: `home-not-indexed:${month}`, title: "The home page is not in Google's index", detail: homeNow.coverageState ?? undefined, url: w.url });
  }
  log.info("index check finished", { websiteId, inspected: results.size, errors, dropped: dropped.length });
  return { inspected: results.size - errors, errors, dropped: dropped.length };
}

const pick = (r: Inspection) => ({ verdict: r.verdict, coverageState: r.coverageState, robotsTxtState: r.robotsTxtState, indexingState: r.indexingState, pageFetchState: r.pageFetchState, googleCanonical: r.googleCanonical, userCanonical: r.userCanonical });

/** Google's own words for why a page is not indexed, in plain English. */
export function indexReason(s: { verdict: string; coverageState: string | null; robotsTxtState: string | null; indexingState: string | null; pageFetchState: string | null; googleCanonical: string | null; userCanonical: string | null }) {
  if (s.robotsTxtState === "DISALLOWED") return "Blocked by robots.txt";
  if (s.indexingState && s.indexingState.startsWith("BLOCKED_BY_META_TAG")) return "Has a noindex tag";
  if (s.indexingState === "BLOCKED_BY_HTTP_HEADER") return "noindex in the X-Robots-Tag header";
  if (s.pageFetchState && s.pageFetchState !== "SUCCESSFUL" && s.pageFetchState !== "PAGE_FETCH_STATE_UNSPECIFIED") return `Google could not fetch it (${s.pageFetchState.toLowerCase().replace(/_/g, " ")})`;
  if (s.googleCanonical && s.userCanonical && s.googleCanonical !== s.userCanonical) return "Google chose a different page as the main version (canonical)";
  return s.coverageState ?? "Not indexed";
}

/** Summary for the website page and the monthly report. */
export async function indexSummary(workspaceId: string, websiteId: string) {
  const rows = await db.indexStatus.findMany({ where: { workspaceId, websiteId }, orderBy: { url: "asc" } });
  const notIndexed = rows.filter((r) => !indexed(r.verdict));
  const reasons = new Map<string, number>();
  for (const r of notIndexed) reasons.set(indexReason(r), (reasons.get(indexReason(r)) ?? 0) + 1);
  return {
    total: rows.length,
    indexed: rows.length - notIndexed.length,
    checkedAt: rows.reduce<Date | null>((m, r) => (!m || r.checkedAt > m ? r.checkedAt : m), null),
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    notIndexed: notIndexed.map((r) => ({ url: r.url, reason: indexReason(r), lastCrawl: r.lastCrawlTime?.toISOString() ?? null })),
  };
}

/** The health tick: robots.txt/sitemaps daily, Google indexing monthly (needs Search Console). */
export async function runSiteHealth(now = new Date()) {
  const robotsDue = await db.website.findMany({ where: { OR: [{ robotsCheckedAt: null }, { robotsCheckedAt: { lt: new Date(now.getTime() - 20 * 3600_000) } }] }, select: { id: true, workspaceId: true }, take: 3 });
  for (const w of robotsDue) {
    await checkRobotsAndSitemap(w.workspaceId, w.id, now).catch(async (e) => {
      log.warn("robots/sitemap check failed", { websiteId: w.id, reason: (e as Error).message });
      await db.website.update({ where: { id: w.id }, data: { robotsCheckedAt: now } });
    });
  }
  const connected = (await db.integrationConnection.findMany({ where: { provider: "SEARCH_CONSOLE", status: "CONNECTED", encryptedSecret: { not: null } }, select: { workspaceId: true } })).map((c) => c.workspaceId);
  if (!connected.length) return;
  const indexDue = await db.website.findFirst({
    where: { gscSiteUrl: { not: null }, workspaceId: { in: connected }, OR: [{ indexCheckedAt: null }, { indexCheckedAt: { lt: new Date(now.getTime() - 30 * DAY) } }] },
    select: { id: true, workspaceId: true },
  });
  if (indexDue) {
    await runIndexCheck(indexDue.workspaceId, indexDue.id, fetch, now).catch(async (e) => {
      log.warn("index check failed", { websiteId: indexDue.id, reason: (e as Error).message });
      // Try again in a few days rather than every tick.
      await db.website.update({ where: { id: indexDue.id }, data: { indexCheckedAt: new Date(now.getTime() - 27 * DAY) } });
    });
  }
}
