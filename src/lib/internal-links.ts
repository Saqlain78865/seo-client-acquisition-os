/**
 * Internal linking suggestions: each page's topic (its Search Console searches, or its title and
 * main heading) is looked for in the text of the other pages. Where a page mentions the topic but
 * does not link to that page yet, the mention is suggested as the link, with the words around it.
 * Pages no other page links to (orphans) come first.
 */

export type LinkPage = { url: string; title: string | null; h1: string | null; text: string; links: string[] };
export type LinkSuggestion = { source: string; target: string; anchor: string; context: string; targetInlinks: number };

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set(["home", "homepage", "welcome", "contact", "contact us", "about", "about us", "blog", "menu", "services", "privacy policy", "terms", "page not found"]);

/** The phrases a page is about: its searches first, then the title (before " | " or " - ") and the H1. */
export function topicsOf(p: LinkPage, queries: string[] = []) {
  const fromTitle = (p.title ?? "").split(/\s[|–—-]\s|:\s/)[0];
  const list = [...queries, fromTitle, p.h1 ?? ""].map(words).filter((t) => t.split(" ").length >= 2 && t.length <= 60 && !STOP.has(t));
  return [...new Set(list)].slice(0, 6);
}

function find(text: string, phrase: string) {
  const at = ` ${text} `.indexOf(` ${phrase} `);
  return at < 0 ? null : at;
}

export function suggestLinks(pages: LinkPage[], queriesByPage: Map<string, string[]> = new Map(), limit = 60): { suggestions: LinkSuggestion[]; orphans: string[] } {
  const home = pages[0] ? norm(pages[0].url) : "";
  const linksOf = new Map(pages.map((p) => [norm(p.url), new Set(p.links.map(norm))]));
  const inlinks = new Map(pages.map((p) => [norm(p.url), 0]));
  for (const [src, set] of linksOf) for (const t of set) if (t !== src && inlinks.has(t)) inlinks.set(t, inlinks.get(t)! + 1);
  const texts = new Map(pages.map((p) => [norm(p.url), words(p.text)]));

  const out: LinkSuggestion[] = [];
  // Pages with the fewest links pointing at them are helped first.
  const targets = pages.filter((p) => norm(p.url) !== home).sort((a, b) => inlinks.get(norm(a.url))! - inlinks.get(norm(b.url))!);
  for (const target of targets) {
    const t = norm(target.url);
    const topics = topicsOf(target, queriesByPage.get(t) ?? queriesByPage.get(`${t}/`) ?? []);
    let perTarget = 0;
    for (const source of pages) {
      const s = norm(source.url);
      if (s === t || linksOf.get(s)!.has(t) || perTarget >= 3) continue;
      const text = texts.get(s)!;
      for (const phrase of topics) {
        const at = find(text, phrase);
        if (at == null) continue;
        const from = Math.max(0, at - 60);
        const context = `${from > 0 ? "…" : ""}${text.slice(from, at + phrase.length + 60).trim()}…`;
        out.push({ source: source.url, target: target.url, anchor: phrase, context, targetInlinks: inlinks.get(t)! });
        perTarget++;
        break;
      }
    }
  }
  const orphans = targets.filter((p) => inlinks.get(norm(p.url)) === 0).map((p) => p.url);
  return { suggestions: out.slice(0, limit), orphans };
}
