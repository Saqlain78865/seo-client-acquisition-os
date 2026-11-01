import "server-only";
import { db } from "./db";
import { logger } from "./log";
import { crawlSite, type CrawledRecord } from "./crawler/crawl";
import { safeFetch } from "./crawler/safe-fetch";
import { runnerOptions } from "./audit/runner";
import { isGbpLink } from "./research/gbp-link";

/**
 * Change log for websites we work on (My Websites and won clients): every week the public site is crawled and each page is
 * compared with what was seen last time — new and removed pages, titles, descriptions, headings,
 * content, status codes, canonicals and noindex. No login to the website is needed.
 */

const DAY = 86400_000;
const PAGE_LIMIT = 80;
const log = logger("site-changes");

export type ChangeKind = "NEW_PAGE" | "REMOVED_PAGE" | "TITLE" | "META_DESCRIPTION" | "H1" | "CONTENT" | "STATUS" | "CANONICAL" | "INDEXING";
export const CHANGE_LABELS: Record<ChangeKind, string> = {
  NEW_PAGE: "New page",
  REMOVED_PAGE: "Page removed",
  TITLE: "Title changed",
  META_DESCRIPTION: "Meta description changed",
  H1: "Main heading changed",
  CONTENT: "Content updated",
  STATUS: "Status changed",
  CANONICAL: "Canonical changed",
  INDEXING: "Indexing changed",
};

type Snap = { url: string; status: number | null; title: string | null; metaDescription: string | null; h1: string | null; canonical: string | null; robotsMeta: string | null; wordCount: number | null; contentHash: string | null };

export function snapshotOf(r: CrawledRecord): Snap | null {
  const url = r.finalUrl ?? r.url;
  if (r.status === null) return null;
  const p = r.page;
  return {
    url,
    status: r.status,
    title: p?.title ?? null,
    metaDescription: p?.metaDescription ?? null,
    h1: p?.h1[0] ?? null,
    canonical: p?.canonical ?? null,
    robotsMeta: p?.robotsMeta ?? null,
    wordCount: p?.wordCount ?? null,
    contentHash: p?.contentHash ?? null,
  };
}

const noindex = (s: string | null) => /noindex/i.test(s ?? "");

/** The differences between two snapshots of one page. Small text edits (< 5% of words) are not reported as content updates. */
export function compare(before: Snap, after: Snap): { kind: ChangeKind; before: string | null; after: string | null }[] {
  const out: { kind: ChangeKind; before: string | null; after: string | null }[] = [];
  const diff = (kind: ChangeKind, a: string | null, b: string | null) => (a ?? "") !== (b ?? "") && out.push({ kind, before: a, after: b });
  if (before.status !== after.status) out.push({ kind: "STATUS", before: String(before.status ?? "—"), after: String(after.status ?? "—") });
  diff("TITLE", before.title, after.title);
  diff("META_DESCRIPTION", before.metaDescription, after.metaDescription);
  diff("H1", before.h1, after.h1);
  diff("CANONICAL", before.canonical, after.canonical);
  if (noindex(before.robotsMeta) !== noindex(after.robotsMeta)) out.push({ kind: "INDEXING", before: noindex(before.robotsMeta) ? "noindex" : "indexable", after: noindex(after.robotsMeta) ? "noindex" : "indexable" });
  if (before.contentHash && after.contentHash && before.contentHash !== after.contentHash) {
    const a = before.wordCount ?? 0;
    const b = after.wordCount ?? 0;
    if (Math.abs(b - a) >= Math.max(20, a * 0.05)) out.push({ kind: "CONTENT", before: `${a} words`, after: `${b} words` });
  }
  return out;
}

/** Whose website is checked: a won client (prospect) or one of My Websites. */
export type ChangeOwner = { prospectId: string } | { websiteId: string };

async function ownerSite(workspaceId: string, owner: ChangeOwner) {
  if ("websiteId" in owner) {
    const w = await db.website.findFirst({ where: { id: owner.websiteId, workspaceId }, select: { url: true } });
    if (!w) throw new Error("Website not found.");
    return w.url;
  }
  const p = await db.prospect.findFirst({ where: { id: owner.prospectId, workspaceId }, select: { websiteUrl: true } });
  if (!p) throw new Error("Prospect not found.");
  return p.websiteUrl;
}

/** Crawls the website, records what changed since the last check, and keeps the new snapshots. */
export async function checkSiteChanges(workspaceId: string, owner: ChangeOwner) {
  const siteUrl = await ownerSite(workspaceId, owner);
  if (isGbpLink(siteUrl)) return { baseline: false, changes: 0, pages: 0 };
  const result = await crawlSite(siteUrl, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks, pageLimit: PAGE_LIMIT, delayMs: 800 });
  const now = new Map<string, Snap>();
  for (const r of result.pages) {
    const s = snapshotOf(r);
    if (s && !now.has(s.url)) now.set(s.url, s);
  }
  const old = new Map((await db.pageSnapshot.findMany({ where: owner })).map((s) => [s.url, s as Snap]));
  const baseline = old.size === 0;
  const changes: { url: string; kind: ChangeKind; before: string | null; after: string | null }[] = [];
  if (!baseline) {
    for (const [url, s] of now) {
      const was = old.get(url);
      if (!was) changes.push({ url, kind: "NEW_PAGE", before: null, after: s.title });
      else for (const c of compare(was, s)) changes.push({ url, ...c });
    }
    // Pages not reached this time (page limit, links changed) are checked directly before being called removed.
    const missing = [...old.keys()].filter((u) => !now.has(u)).slice(0, 25);
    for (const url of missing) {
      const r = await safeFetch(url, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks, acceptBody: () => false, timeoutMs: 20_000, retries: 1 }).catch(() => null);
      if (r && (r.status === 404 || r.status === 410)) changes.push({ url, kind: "REMOVED_PAGE", before: old.get(url)!.title, after: String(r.status) });
    }
  }
  const at = new Date();
  await db.$transaction([
    ...(changes.length ? [db.siteChange.createMany({ data: changes.map((c) => ({ workspaceId, ...owner, url: c.url, kind: c.kind, before: c.before?.slice(0, 500) ?? null, after: c.after?.slice(0, 500) ?? null })) })] : []),
    ...[...now.values()].map((s) =>
      db.pageSnapshot.upsert({
        where: "websiteId" in owner ? { websiteId_url: { websiteId: owner.websiteId, url: s.url } } : { prospectId_url: { prospectId: owner.prospectId, url: s.url } },
        create: { ...owner, ...s, takenAt: at },
        update: { ...s, takenAt: at },
      }),
    ),
    ...changes.filter((c) => c.kind === "REMOVED_PAGE").map((c) => db.pageSnapshot.deleteMany({ where: { ...owner, url: c.url } })),
    "websiteId" in owner ? db.website.update({ where: { id: owner.websiteId }, data: { changesCheckedAt: at } }) : db.prospect.update({ where: { id: owner.prospectId }, data: { changesCheckedAt: at } }),
  ]);
  return { baseline, changes: changes.length, pages: now.size };
}

/**
 * Weekly checks for the websites being worked on: My Websites and won clients. A few per run, so
 * the app stays responsive.
 */
export async function runWeeklyChangeChecks(now = new Date()) {
  const stale = { OR: [{ changesCheckedAt: null }, { changesCheckedAt: { lt: new Date(now.getTime() - 7 * DAY) } }] };
  const [websites, clients] = await Promise.all([
    db.website.findMany({ where: stale, select: { id: true, workspaceId: true }, take: 2 }),
    db.prospect.findMany({ where: { status: "WON", ...stale }, select: { id: true, workspaceId: true }, take: 2 }),
  ]);
  const due: { workspaceId: string; owner: ChangeOwner }[] = [
    ...websites.map((w) => ({ workspaceId: w.workspaceId, owner: { websiteId: w.id } })),
    ...clients.map((p) => ({ workspaceId: p.workspaceId, owner: { prospectId: p.id } })),
  ].slice(0, 2);
  for (const d of due) {
    await checkSiteChanges(d.workspaceId, d.owner).catch(async (e) => {
      log.warn("change check failed", { ...d.owner, reason: (e as Error).message });
      // Try again tomorrow rather than every hour.
      const retry = { changesCheckedAt: new Date(now.getTime() - 6 * DAY) };
      if ("websiteId" in d.owner) await db.website.update({ where: { id: d.owner.websiteId }, data: retry });
      else await db.prospect.update({ where: { id: d.owner.prospectId }, data: retry });
    });
  }
  return due.length;
}

/** Changes found in one month (YYYY-MM), newest first. */
export async function monthChanges(workspaceId: string, owner: ChangeOwner, month: string) {
  const [y, m] = month.split("-").map(Number);
  return db.siteChange.findMany({
    where: { workspaceId, ...owner, detectedAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
    orderBy: { detectedAt: "desc" },
    take: 300,
  });
}
