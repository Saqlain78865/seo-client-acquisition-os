import "server-only";
import { db } from "./db";
import { normalizeDomain, normalizeWebsiteUrl } from "./url";
import { checkSiteChanges } from "./site-changes";

/**
 * Competitor website watch for My Websites: up to three competitor sites per website, crawled
 * every week like the client's own site (public pages only). The monthly report lists what they
 * did: new pages and articles, title changes, content updates.
 */

export const MAX_COMPETITORS = 3;
export class CompetitorWatchError extends Error {}

export async function addWatchedCompetitor(workspaceId: string, websiteId: string, input: { name?: string; url: string }) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId }, select: { domain: true, _count: { select: { competitors: true } } } });
  if (!w) throw new CompetitorWatchError("Website not found.");
  let url: string;
  try {
    url = `${new URL(normalizeWebsiteUrl(input.url.trim())).origin}/`;
  } catch {
    throw new CompetitorWatchError("Enter the competitor's website address, e.g. competitor.com");
  }
  const domain = normalizeDomain(url);
  if (!domain.includes(".")) throw new CompetitorWatchError("Enter the competitor's website address, e.g. competitor.com");
  if (domain === w.domain) throw new CompetitorWatchError("That is this website itself.");
  if (w._count.competitors >= MAX_COMPETITORS) throw new CompetitorWatchError(`Up to ${MAX_COMPETITORS} competitors per website.`);
  const exists = await db.watchedCompetitor.findUnique({ where: { websiteId_domain: { websiteId, domain } } });
  if (exists) throw new CompetitorWatchError(`${domain} is already watched.`);
  return db.watchedCompetitor.create({ data: { workspaceId, websiteId, url, domain, name: (input.name?.trim() || domain).slice(0, 120) } });
}

export async function removeWatchedCompetitor(workspaceId: string, id: string) {
  const { count } = await db.watchedCompetitor.deleteMany({ where: { id, workspaceId } });
  if (!count) throw new CompetitorWatchError("Competitor not found.");
}

export async function checkCompetitorNow(workspaceId: string, id: string) {
  const c = await db.watchedCompetitor.findFirst({ where: { id, workspaceId } });
  if (!c) throw new CompetitorWatchError("Competitor not found.");
  return checkSiteChanges(workspaceId, { competitorId: c.id });
}

export type CompetitorActivity = {
  id: string;
  name: string;
  domain: string;
  checkedAt: Date | null;
  newPages: { url: string; title: string | null }[];
  titleChanges: { url: string; before: string | null; after: string | null }[];
  contentUpdates: number;
  removed: number;
};

/** What each competitor did in one month (YYYY-MM), from the weekly checks. */
export async function competitorActivity(workspaceId: string, websiteId: string, month: string): Promise<CompetitorActivity[]> {
  const [y, m] = month.split("-").map(Number);
  const list = await db.watchedCompetitor.findMany({
    where: { workspaceId, websiteId },
    orderBy: { createdAt: "asc" },
    include: { changes: { where: { detectedAt: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } }, orderBy: { detectedAt: "desc" }, take: 300 } },
  });
  return list.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    checkedAt: c.changesCheckedAt,
    newPages: c.changes.filter((x) => x.kind === "NEW_PAGE").map((x) => ({ url: x.url, title: x.after })),
    titleChanges: c.changes.filter((x) => x.kind === "TITLE").map((x) => ({ url: x.url, before: x.before, after: x.after })),
    contentUpdates: c.changes.filter((x) => x.kind === "CONTENT").length,
    removed: c.changes.filter((x) => x.kind === "REMOVED_PAGE").length,
  }));
}
