import { classifyPage, languagePrefix, type PageType } from "./classify";
import { extractPage, sameSite, type ExtractedPage } from "./extract";
import { BlockedUrlError, assertPublicHost, type GuardOptions } from "./network-guard";
import { discoverSitemaps, fetchRobots, type RobotsInfo, type SitemapInfo } from "./robots-sitemap";
import { renderPage } from "./render";
import { FetchError, isHtml, isTransient, isXmlOrText, safeFetch } from "./safe-fetch";

export type CrawledRecord = {
  url: string;
  finalUrl: string | null;
  status: number | null;
  redirectChain: { url: string; status: number }[];
  responseTimeMs: number | null;
  bytes: number | null;
  contentType: string | null;
  xRobotsTag: string | null;
  page: ExtractedPage | null;
  pageType: PageType | null;
  rendered: boolean;
  rawWordCount: number | null;
  error: string | null;
  discoveredVia: "start" | "sitemap" | "link";
  linkedFrom: string | null;
};

export type CrawlResult = {
  startUrl: string;
  homepageUrl: string;
  origin: string;
  robots: RobotsInfo;
  llmsTxt: { found: boolean; status: number | null };
  sitemaps: SitemapInfo;
  httpToHttps: { checked: boolean; redirectsToHttps: boolean | null; finalUrl: string | null; error?: string };
  pages: CrawledRecord[];
  skipped: { url: string; reason: string }[];
  limitReached: boolean;
};

export type CrawlOptions = GuardOptions & {
  pageLimit: number;
  delayMs: number;
  /** Pages fetched at the same time (default 4, at most 8); 1 when robots.txt sets a crawl delay. */
  concurrency?: number;
  /** "offers": spend a small page budget on service/tour pages first (competitor checks). */
  focus?: "offers";
  maxRenders?: number;
  onProgress?: (p: { crawled: number; found: number; current: string }) => Promise<void> | void;
};

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|gz|mp4|mov|avi|mp3|wav|docx?|xlsx?|pptx?|css|js|json|xml|txt|woff2?|ttf|eot)$/i;
const SKIP_PATHS = /\/(wp-admin|wp-login|wp-json|cart|checkout|my-account|account|login|logout|signin|signup|register|admin|cgi-bin|feed)\b|[?&](add-to-cart|replytocom|s|search|q|sort|orderby|filter)=/i;
// Query parameters that choose a different page rather than vary the same one.
const PAGE_PARAMS = /[?&](p|page_id|post|id|cat|product|product_id|item|lang)=/i;
const OFFER_PATH = /(service|treatment|tour|safari|ride|rental|hire|package|collection|experience|trip|excursion|cruise|product|course|class|lesson|pricing|price)/i;
const LOW_VALUE_PATH = /\/(about|careers?|jobs|privacy|terms|cookie|legal|partners|press|blog|news|tag|category|author)(\/|$|-)/i;
const IMPORTANT = /(contact|about|service|treatment|solution|location|area|pricing|price|package|faq|book|appointment|team|reviews?|testimonials?)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalise(u: string) {
  const x = new URL(u);
  x.hash = "";
  if ((x.protocol === "https:" && x.port === "443") || (x.protocol === "http:" && x.port === "80")) x.port = "";
  return x.toString();
}

function looksClientRendered(p: ExtractedPage) {
  return p.wordCount < 80 && (p.appRootDetected || p.scriptCount >= 3);
}

/**
 * Crawls a public website conservatively: robots.txt respected, same site only, one request at a
 * time with a delay, page limit, and SSRF-safe fetching. Results are reported per page through the
 * returned records; nothing here writes to the database.
 */
export async function crawlSite(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const guard: GuardOptions = { allowPrivateNetworks: options.allowPrivateNetworks };
  const start = new URL(startUrl);
  await assertPublicHost(start.hostname, guard);

  // Resolve the canonical homepage first (follows http→https and www redirects).
  const first = await safeFetch(`${start.origin}/`, { ...guard, acceptBody: isHtml }).catch((e) => {
    if (!isTransient(e)) throw e;
    throw new FetchError(
      `The website did not respond after 3 attempts (${(e as Error).message}). It may be down, overloaded, or blocking automated visitors — try Retry in a few minutes.`,
      (e as FetchError).url,
      (e as FetchError).code,
    );
  });
  const homepageUrl = normalise(first.finalUrl);
  const home = new URL(homepageUrl);
  const origin = home.origin;
  const robots = await fetchRobots(origin, guard);
  const sitemaps = await discoverSitemaps(origin, robots.sitemaps, guard);
  // Optional plain-text summary for AI tools. Sites that answer every path with an HTML page do not count.
  const llmsTxt = await safeFetch(`${origin}/llms.txt`, { ...guard, maxBytes: 64 * 1024, acceptBody: isXmlOrText, timeoutMs: 10_000, retries: 0 }).then(
    (r) => ({ found: r.status === 200 && /\S/.test(r.body ?? "") && !/<html|<!doctype/i.test(r.body ?? ""), status: r.status }),
    () => ({ found: false, status: null }),
  );
  const delay = Math.max(options.delayMs, Math.min((robots.crawlDelaySec ?? 0) * 1000, 10_000));

  // Does plain http redirect to https?
  const httpToHttps: CrawlResult["httpToHttps"] = { checked: false, redirectsToHttps: null, finalUrl: null };
  if (home.protocol === "https:") {
    try {
      const r = await safeFetch(`http://${home.host}/`, { ...guard, method: "GET", acceptBody: () => false, timeoutMs: 10_000 });
      httpToHttps.checked = true;
      httpToHttps.finalUrl = r.finalUrl;
      httpToHttps.redirectsToHttps = r.finalUrl.startsWith("https://");
    } catch (e) {
      httpToHttps.error = (e as Error).message;
    }
  }

  const homeLanguage = languagePrefix(homepageUrl);
  const queue: { url: string; via: CrawledRecord["discoveredVia"]; from: string | null; priority: number }[] = [];
  const queued = new Set<string>();
  const queryVariants = new Map<string, number>();
  const skipped: CrawlResult["skipped"] = [];
  const pages: CrawledRecord[] = [];
  let renders = 0;

  const enqueue = (raw: string, via: CrawledRecord["discoveredVia"], from: string | null, priority: number) => {
    let url: string;
    try {
      url = normalise(raw);
    } catch {
      return;
    }
    if (queued.has(url)) return;
    const u = new URL(url);
    if (!sameSite(u, home) || (u.protocol !== "http:" && u.protocol !== "https:")) return;
    queued.add(url);
    if (SKIP_EXTENSIONS.test(u.pathname)) return void skipped.push({ url, reason: "Not an HTML page" });
    if (SKIP_PATHS.test(u.pathname + u.search)) return void skipped.push({ url, reason: "Account, cart, search or admin URL" });
    if (!robots.isAllowed(url)) return void skipped.push({ url, reason: "Disallowed by robots.txt" });
    if (u.search && !PAGE_PARAMS.test(u.search)) {
      const key = u.origin + u.pathname;
      const seen = queryVariants.get(key) ?? 0;
      queryVariants.set(key, seen + 1);
      if (seen >= 1) return void skipped.push({ url, reason: "Same page with a different query string" });
    }
    let boost = IMPORTANT.test(u.pathname) ? 20 : 0;
    // Translations repeat the same content: crawl them last.
    if (languagePrefix(url) !== homeLanguage) boost -= 40;
    if (options.focus === "offers") boost += OFFER_PATH.test(u.pathname) && !LOW_VALUE_PATH.test(u.pathname) ? 30 : LOW_VALUE_PATH.test(u.pathname) ? -30 : 0;
    queue.push({ url, via, from, priority: priority + boost - u.pathname.split("/").length });
  };

  enqueue(homepageUrl, "start", null, 1000);
  for (const s of sitemaps.urls.slice(0, 500)) enqueue(s, "sitemap", null, 10);

  // Pages are fetched a few at a time, with a pause between batches. A site that asks for a
  // crawl delay in robots.txt is crawled one page at a time, as before.
  const concurrency = robots.crawlDelaySec ? 1 : Math.max(1, Math.min(options.concurrency ?? 4, 8));
  let renderChain: Promise<unknown> = Promise.resolve();
  const renderOne = <T>(fn: () => Promise<T>) => {
    const run = renderChain.then(fn, fn);
    renderChain = run.catch(() => null);
    return run.catch(() => null);
  };

  const crawlOne = async (next: (typeof queue)[number]): Promise<CrawledRecord> => {
    const record: CrawledRecord = {
      url: next.url,
      finalUrl: null,
      status: null,
      redirectChain: [],
      responseTimeMs: null,
      bytes: null,
      contentType: null,
      xRobotsTag: null,
      page: null,
      pageType: null,
      rendered: false,
      rawWordCount: null,
      error: null,
      discoveredVia: next.via,
      linkedFrom: next.from,
    };
    try {
      const res = await safeFetch(next.url, { ...guard, acceptBody: isHtml });
      record.finalUrl = res.finalUrl;
      record.status = res.status;
      record.redirectChain = res.redirectChain;
      record.responseTimeMs = res.responseTimeMs;
      record.bytes = res.bytes;
      record.contentType = res.contentType;
      record.xRobotsTag = res.headers["x-robots-tag"] ?? null;

      const finalSameSite = sameSite(new URL(res.finalUrl), home);
      const finalNorm = normalise(res.finalUrl);
      // A redirect onto a page we already have (or will crawl) is recorded as a redirect only, so the page is not counted twice.
      const duplicateTarget = finalNorm !== next.url && queued.has(finalNorm);
      if (res.status < 400 && isHtml(res.contentType) && finalSameSite && !duplicateTarget) {
        let page = extractPage(res.body, res.finalUrl);
        record.rawWordCount = page.wordCount;
        if (looksClientRendered(page) && renders < (options.maxRenders ?? 5)) {
          renders++;
          // One headless browser at a time, even when pages are fetched in parallel.
          const r = await renderOne(() => renderPage(res.finalUrl, guard));
          if (r) {
            const renderedPage = extractPage(r.html, r.finalUrl);
            if (renderedPage.wordCount > page.wordCount) {
              page = renderedPage;
              record.rendered = true;
            }
          }
        }
        record.page = page;
        record.pageType = classifyPage(res.finalUrl, page, homepageUrl).type;
        if (res.truncated) record.error = "Page larger than 3 MB; only the first 3 MB were analysed";
        for (const l of page.internalLinks) if (!l.nofollow) enqueue(l.url, "link", res.finalUrl, 0);
        // A redirect target is a page of its own — make sure the canonical version is known.
        if (finalNorm !== next.url) queued.add(finalNorm);
      } else if (!finalSameSite) {
        record.error = `Redirects off-site to ${new URL(res.finalUrl).hostname}`;
      }
    } catch (e) {
      record.error = e instanceof BlockedUrlError ? `Blocked: ${e.message}` : e instanceof FetchError ? e.message : "Unexpected error while fetching";
    }
    return record;
  };

  let limitReached = false;
  while (queue.length) {
    if (pages.length >= options.pageLimit) {
      limitReached = true;
      break;
    }
    queue.sort((a, b) => b.priority - a.priority);
    const batch = queue.splice(0, Math.min(concurrency, options.pageLimit - pages.length));
    await options.onProgress?.({ crawled: pages.length, found: queued.size, current: batch[0].url });
    if (pages.length > 0) await sleep(delay);
    // Records keep the order the pages were taken from the queue.
    pages.push(...(await Promise.all(batch.map(crawlOne))));
  }
  await options.onProgress?.({ crawled: pages.length, found: queued.size, current: "" });

  return { startUrl, homepageUrl, origin, robots, llmsTxt, sitemaps, httpToHttps, pages, skipped, limitReached };
}
