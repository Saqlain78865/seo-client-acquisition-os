import robotsParser from "robots-parser";
import * as cheerio from "cheerio";
import { FetchError, isXmlOrText, safeFetch, ROBOTS_USER_AGENT } from "./safe-fetch";
import { BlockedUrlError, type GuardOptions } from "./network-guard";

export type RobotsInfo = {
  url: string;
  status: number | null;
  found: boolean;
  body: string | null;
  error: string | null;
  sitemaps: string[];
  crawlDelaySec: number | null;
  /** True when "Disallow: /" applies to all crawlers (Googlebot included). */
  blocksEverything: boolean;
  blocksGooglebotHomepage: boolean;
  isAllowed: (url: string) => boolean;
};

export async function fetchRobots(origin: string, guard: GuardOptions): Promise<RobotsInfo> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await safeFetch(url, { ...guard, maxBytes: 512 * 1024, acceptBody: isXmlOrText });
    if (res.status >= 400) {
      // 4xx: no robots.txt — everything is allowed. 5xx: Google treats the site as fully disallowed for a while.
      return {
        url,
        status: res.status,
        found: false,
        body: null,
        error: res.status >= 500 ? `robots.txt returned HTTP ${res.status}` : null,
        sitemaps: [],
        crawlDelaySec: null,
        blocksEverything: false,
        blocksGooglebotHomepage: false,
        isAllowed: () => true,
      };
    }
    const robots = robotsParser(res.finalUrl, res.body);
    const ua = ROBOTS_USER_AGENT;
    return {
      url,
      status: res.status,
      found: true,
      body: res.body.slice(0, 20_000),
      error: null,
      sitemaps: robots.getSitemaps(),
      crawlDelaySec: robots.getCrawlDelay(ua) ?? null,
      blocksEverything: robots.isDisallowed(`${origin}/`, "*") === true,
      blocksGooglebotHomepage: robots.isDisallowed(`${origin}/`, "Googlebot") === true,
      isAllowed: (u: string) => robots.isAllowed(u, ua) !== false,
    };
  } catch (e) {
    if (e instanceof BlockedUrlError) throw e;
    return {
      url,
      status: null,
      found: false,
      body: null,
      error: e instanceof FetchError ? e.message : "robots.txt could not be fetched",
      sitemaps: [],
      crawlDelaySec: null,
      blocksEverything: false,
      blocksGooglebotHomepage: false,
      isAllowed: () => true,
    };
  }
}

export type SitemapInfo = {
  checked: { url: string; status: number | null; kind: "urlset" | "index" | "invalid" | "missing"; urlCount: number; error?: string }[];
  urls: string[];
};

/** Reads sitemaps declared in robots.txt plus the conventional locations. Follows one level of sitemap index. */
export async function discoverSitemaps(origin: string, declared: string[], guard: GuardOptions, maxUrls = 2000): Promise<SitemapInfo> {
  const queue = [...new Set([...declared, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])].slice(0, 10);
  const checked: SitemapInfo["checked"] = [];
  const urls = new Set<string>();
  const visited = new Set<string>();

  while (queue.length && checked.length < 15 && urls.size < maxUrls) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);
    try {
      const res = await safeFetch(sm, { ...guard, maxBytes: 5 * 1024 * 1024, acceptBody: (ct) => isXmlOrText(ct) || /html/.test(ct) });
      if (res.status >= 400) {
        checked.push({ url: sm, status: res.status, kind: "missing", urlCount: 0 });
        continue;
      }
      const $ = cheerio.load(res.body, { xml: true });
      const locs = $("sitemap > loc").toArray().map((el) => $(el).text().trim());
      if (locs.length) {
        checked.push({ url: sm, status: res.status, kind: "index", urlCount: locs.length });
        for (const l of locs.slice(0, 20)) if (!visited.has(l)) queue.push(l);
        continue;
      }
      const pageLocs = $("url > loc").toArray().map((el) => $(el).text().trim());
      if (pageLocs.length === 0) {
        checked.push({ url: sm, status: res.status, kind: "invalid", urlCount: 0, error: "No <url><loc> entries found" });
        continue;
      }
      checked.push({ url: sm, status: res.status, kind: "urlset", urlCount: pageLocs.length });
      for (const l of pageLocs) if (urls.size < maxUrls) urls.add(l);
    } catch (e) {
      checked.push({ url: sm, status: null, kind: "missing", urlCount: 0, error: (e as Error).message });
    }
  }
  return { checked, urls: [...urls] };
}
