import "server-only";
import { db } from "./db";
import { crawlSite } from "./crawler/crawl";
import { safeFetch } from "./crawler/safe-fetch";
import { runnerOptions } from "./audit/runner";
import { checkExternal, internalIssues, linkSources } from "./link-audit";

/** Crawls the website (up to 100 pages) and checks every link found, including up to 150 external ones. */
export async function runLinkAudit(workspaceId: string, websiteId: string) {
  const w = await db.website.findFirst({ where: { id: websiteId, workspaceId } });
  if (!w) throw new Error("Website not found.");
  const guard = { allowPrivateNetworks: runnerOptions.allowPrivateNetworks };
  const crawl = await crawlSite(w.url, { ...guard, pageLimit: 100, delayMs: 300 });
  const { broken, redirects, canonicals } = internalIssues(crawl.pages, crawl.origin);
  const { external } = linkSources(crawl.pages);
  const externalBroken = await checkExternal(external, async (url) => {
    try {
      const r = await safeFetch(url, { allowPrivateNetworks: false, acceptBody: () => false, timeoutMs: 15_000, retries: 1 });
      return { status: r.status, error: null };
    } catch (e) {
      return { status: null, error: (e as Error).message.slice(0, 160) };
    }
  });
  return {
    pagesChecked: crawl.pages.length,
    externalChecked: Math.min(external.size, 150),
    broken: [...broken, ...externalBroken],
    redirects,
    canonicals,
  };
}
