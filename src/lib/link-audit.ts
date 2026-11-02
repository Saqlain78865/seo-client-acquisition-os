import type { CrawledRecord } from "./crawler/crawl";

/**
 * Link and redirect audit of a website, from one crawl: broken internal and external links (with
 * the pages they are on), links that point at redirects, redirect chains and loops, and canonical
 * tags that point somewhere wrong. External links are checked with one light request each.
 */

export type BrokenLink = { url: string; status: number | null; error: string | null; internal: boolean; foundOn: string[]; blockedBots: boolean };
export type RedirectIssue = { url: string; kind: "CHAIN" | "LOOP" | "LINKED_REDIRECT"; hops: string[]; finalUrl: string | null; foundOn: string[] };
export type CanonicalIssue = { page: string; canonical: string; problem: string };

const norm = (u: string) => u.replace(/#.*$/, "");

/** Pages linking to each URL (internal and external), from the crawl. */
export function linkSources(pages: CrawledRecord[]) {
  const internal = new Map<string, Set<string>>();
  const external = new Map<string, Set<string>>();
  for (const r of pages) {
    if (!r.page) continue;
    const from = r.finalUrl ?? r.url;
    for (const l of r.page.internalLinks) (internal.get(norm(l.url)) ?? internal.set(norm(l.url), new Set()).get(norm(l.url))!).add(from);
    for (const l of r.page.externalLinks) if (/^https?:/i.test(l.url)) (external.get(norm(l.url)) ?? external.set(norm(l.url), new Set()).get(norm(l.url))!).add(from);
  }
  return { internal, external };
}

export function internalIssues(pages: CrawledRecord[], origin: string) {
  const { internal } = linkSources(pages);
  const broken: BrokenLink[] = [];
  const redirects: RedirectIssue[] = [];
  const canonicals: CanonicalIssue[] = [];
  const byUrl = new Map(pages.map((r) => [norm(r.url), r]));
  const finalOk = new Map<string, number | null>();
  for (const r of pages) finalOk.set(norm(r.finalUrl ?? r.url), r.status);

  for (const r of pages) {
    const sources = [...(internal.get(norm(r.url)) ?? [])].slice(0, 10);
    if (r.status == null || r.status >= 400) {
      const loop = /redirect/i.test(r.error ?? "");
      if (loop) redirects.push({ url: r.url, kind: "LOOP", hops: r.redirectChain.map((h) => h.url), finalUrl: null, foundOn: sources });
      else broken.push({ url: r.url, status: r.status, error: r.error, internal: true, foundOn: sources, blockedBots: false });
      continue;
    }
    if (r.redirectChain.length >= 2) redirects.push({ url: r.url, kind: "CHAIN", hops: [...r.redirectChain.map((h) => h.url), r.finalUrl ?? r.url], finalUrl: r.finalUrl, foundOn: sources });
    else if (r.redirectChain.length === 1 && sources.length) redirects.push({ url: r.url, kind: "LINKED_REDIRECT", hops: [r.url, r.finalUrl ?? r.url], finalUrl: r.finalUrl, foundOn: sources });

    const canonical = r.page?.canonical;
    const self = norm(r.finalUrl ?? r.url);
    if (canonical && norm(canonical) !== self) {
      let problem: string | null = null;
      try {
        const c = new URL(canonical);
        if (c.origin !== origin && c.hostname.replace(/^www\./, "") !== new URL(origin).hostname.replace(/^www\./, "")) problem = "Points to another website";
        else if (c.protocol === "http:" && origin.startsWith("https:")) problem = "Points to the http:// version";
        else {
          const target = byUrl.get(norm(canonical));
          const status = target?.status ?? finalOk.get(norm(canonical));
          if (target && target.redirectChain.length) problem = "Points to a page that redirects";
          else if (status != null && status >= 400) problem = `Points to a page that returns ${status}`;
        }
      } catch {
        problem = "Not a valid address";
      }
      if (problem) canonicals.push({ page: r.finalUrl ?? r.url, canonical, problem });
    }
  }
  return { broken, redirects, canonicals };
}

/** Status codes that mean "this site turns robots away", not "this link is broken". */
const BOT_BLOCK = new Set([401, 403, 405, 429, 999]);

export async function checkExternal(external: Map<string, Set<string>>, check: (url: string) => Promise<{ status: number | null; error: string | null }>, limit = 150): Promise<BrokenLink[]> {
  const urls = [...external.keys()].slice(0, limit);
  const out: BrokenLink[] = [];
  for (let i = 0; i < urls.length; i += 6) {
    const done = await Promise.all(urls.slice(i, i + 6).map(async (url) => ({ url, ...(await check(url)) })));
    for (const d of done) {
      if (d.status != null && d.status < 400) continue;
      const blockedBots = d.status != null && BOT_BLOCK.has(d.status);
      out.push({ url: d.url, status: d.status, error: d.error, internal: false, foundOn: [...external.get(d.url)!].slice(0, 10), blockedBots });
    }
  }
  return out;
}
