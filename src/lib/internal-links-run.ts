import "server-only";
import { db } from "./db";
import { crawlSite } from "./crawler/crawl";
import { runnerOptions } from "./audit/runner";
import { analyticsRows } from "./search-console";
import { suggestLinks, type LinkPage } from "./internal-links";

const DAY = 86400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Reads the website's public pages (and its searches per page, when Search Console is linked) and suggests internal links. */
export async function internalLinkSuggestions(workspaceId: string, websiteId: string, fetchImpl: typeof fetch = fetch) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId } });
  if (!w) throw new Error("Website not found.");
  const crawl = await crawlSite(w.url, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks, pageLimit: 60, delayMs: 300 });
  const pages: LinkPage[] = crawl.pages
    .filter((r) => r.page && r.status && r.status < 300 && r.page.wordCount > 50)
    .map((r) => ({ url: r.finalUrl ?? r.url, title: r.page!.title, h1: r.page!.h1[0] ?? null, text: r.page!.text, links: r.page!.internalLinks.filter((l) => !l.nofollow).map((l) => l.url) }));
  const queriesByPage = new Map<string, string[]>();
  if (w.gscSiteUrl) {
    const now = new Date();
    const rows = await analyticsRows(workspaceId, websiteId, { startDate: ymd(new Date(now.getTime() - 29 * DAY)), endDate: ymd(new Date(now.getTime() - DAY)), dimensions: ["page", "query"], rowLimit: 5000 }, fetchImpl).catch(() => []);
    for (const r of rows.sort((a, b) => b.impressions - a.impressions)) {
      const page = (r.keys[0] ?? "").replace(/#.*$/, "").replace(/\/$/, "");
      const list = queriesByPage.get(page) ?? [];
      if (list.length < 5 && r.keys[1]) queriesByPage.set(page, [...list, r.keys[1]]);
    }
  }
  return { pagesRead: pages.length, usedSearchConsole: queriesByPage.size > 0, ...suggestLinks(pages, queriesByPage) };
}
