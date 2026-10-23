import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

/**
 * Pure HTML → structured page facts. Website content is treated strictly as data:
 * nothing here executes scripts or follows instructions found in the page.
 */

export type ExtractedLink = { url: string; text: string; nofollow: boolean };
export type ExtractedImage = { src: string; alt: string | null; width?: string; height?: string; lazy: boolean };
export type Heading = { level: number; text: string };

export type ExtractedPage = {
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  canonical: string | null;
  canonicalCount: number;
  robotsMeta: string | null;
  lang: string | null;
  viewport: string | null;
  h1: string[];
  headings: Heading[];
  wordCount: number;
  text: string;
  textExcerpt: string;
  contentHash: string;
  shingles: string[];
  internalLinks: ExtractedLink[];
  externalLinks: ExtractedLink[];
  images: ExtractedImage[];
  structuredData: { types: string[]; jsonLdErrors: number; items: unknown[] };
  hreflang: { lang: string; href: string }[];
  pagination: { next: string | null; prev: string | null };
  mixedContent: string[];
  forms: { action: string | null; method: string; fields: string[]; hasEmailField: boolean; hasTextarea: boolean; hasPassword: boolean }[];
  telLinks: string[];
  mailtoLinks: string[];
  whatsappLinks: string[];
  socialLinks: string[];
  ogSiteName: string | null;
  scriptCount: number;
  appRootDetected: boolean;
  footerText: string;
};

const SOCIAL_HOSTS = /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com)$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function resolve(href: string | undefined, base: URL): URL | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(javascript|data|blob):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** www.example.com and example.com count as the same site. */
export function sameSite(a: URL, b: URL) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

/** 5-word shingles of normalised text, used for near-duplicate detection. */
export function shingle(text: string, size = 5, max = 4000): string[] {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length && out.size < max; i++) {
    out.add(createHash("md5").update(words.slice(i, i + size).join(" ")).digest("hex").slice(0, 12));
  }
  return [...out];
}

export function jaccard(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const x of b) if (sa.has(x)) inter++;
  return inter / (sa.size + b.length - inter);
}

function collectTypes(node: unknown, out: Set<string>, items: unknown[], depth = 0) {
  if (depth > 6 || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out, items, depth + 1));
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
  if (t && items.length < 30) items.push(obj);
  for (const [k, v] of Object.entries(obj)) if (k !== "@context") collectTypes(v, out, items, depth + 1);
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const base = new URL(pageUrl);
  const $ = cheerio.load(html);
  const baseHref = $("base[href]").attr("href");
  const resolveBase = baseHref ? (resolve(baseHref, base) ?? base) : base;

  // <title> inside inline SVG icons is not a document title.
  const titles = $("title")
    .filter((_, el) => $(el).parents("svg").length === 0)
    .toArray();
  const metaDesc = $('meta[name="description" i]').toArray();
  const canonicals = $('link[rel~="canonical" i]').toArray();

  // Structured data before we strip scripts.
  const types = new Set<string>();
  const items: unknown[] = [];
  let jsonLdErrors = 0;
  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      collectTypes(JSON.parse(raw), types, items);
    } catch {
      jsonLdErrors++;
    }
  });
  $("[itemtype]").each((_, el) => {
    const t = $(el).attr("itemtype")?.split("/").pop();
    if (t) types.add(t);
  });

  const scriptCount = $("script[src]").length;
  const appRootDetected = $("#root, #__next, #app, #__nuxt, [ng-version], [data-reactroot]").length > 0;

  // Mixed content: http:// subresources on an https page.
  const mixedContent: string[] = [];
  if (base.protocol === "https:") {
    $("img[src], script[src], link[rel=stylesheet][href], iframe[src], video[src], audio[src], source[src]").each((_, el) => {
      const v = $(el).attr("src") ?? $(el).attr("href");
      if (v && /^http:\/\//i.test(v.trim()) && mixedContent.length < 50) mixedContent.push(v.trim());
    });
  }

  const internalLinks: ExtractedLink[] = [];
  const externalLinks: ExtractedLink[] = [];
  const seen = new Set<string>();
  const telLinks: string[] = [];
  const mailtoLinks: string[] = [];
  const whatsappLinks: string[] = [];
  const socialLinks: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!.trim();
    if (/^tel:/i.test(href)) return void telLinks.push(decodeURIComponent(href.slice(4)).trim());
    if (/^mailto:/i.test(href)) return void mailtoLinks.push(decodeURIComponent(href.slice(7).split("?")[0]).trim());
    const u = resolve(href, resolveBase);
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return;
    if (/(^|\.)wa\.me$|(^|\.)api\.whatsapp\.com$|(^|\.)web\.whatsapp\.com$/i.test(u.hostname)) {
      whatsappLinks.push(u.toString());
      return;
    }
    if (SOCIAL_HOSTS.test(u.hostname)) socialLinks.push(u.toString());
    const key = u.toString();
    if (seen.has(key)) return;
    seen.add(key);
    const link = { url: key, text: clean($(el).text()).slice(0, 120), nofollow: /nofollow/i.test($(el).attr("rel") ?? "") };
    (sameSite(u, base) ? internalLinks : externalLinks).push(link);
  });

  const images: ExtractedImage[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
    const u = resolve(src, resolveBase);
    if (!u || images.length >= 300) return;
    const alt = $(el).attr("alt");
    images.push({
      src: u.toString(),
      alt: alt === undefined ? null : clean(alt),
      width: $(el).attr("width"),
      height: $(el).attr("height"),
      lazy: $(el).attr("loading") === "lazy" || !!$(el).attr("data-src"),
    });
  });

  const forms = $("form")
    .toArray()
    .slice(0, 20)
    .map((f) => {
      const fields = $(f)
        .find("input, textarea, select")
        .toArray()
        .map((i) => ($(i).attr("type") ?? i.tagName).toLowerCase());
      return {
        action: $(f).attr("action") ?? null,
        method: ($(f).attr("method") ?? "get").toLowerCase(),
        fields,
        hasEmailField: $(f).find('input[type=email], input[name*="mail" i]').length > 0,
        hasTextarea: $(f).find("textarea").length > 0,
        hasPassword: $(f).find("input[type=password]").length > 0,
      };
    });

  const hreflang = $('link[rel="alternate" i][hreflang]')
    .toArray()
    .map((el) => ({ lang: $(el).attr("hreflang")!, href: resolve($(el).attr("href"), resolveBase)?.toString() ?? "" }))
    .filter((x) => x.href);

  const footerText = clean($("footer").text()).slice(0, 2000);

  // Visible text: drop non-content elements.
  $("script, style, noscript, template, svg, iframe").remove();
  const headings: Heading[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (headings.length < 200) headings.push({ level: Number(el.tagName[1]), text: clean($(el).text()).slice(0, 200) });
  });
  const text = clean($("body").text() || $.root().text());
  const words = text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)) : [];

  return {
    title: titles.length ? clean($(titles[0]).text()) || null : null,
    titleCount: titles.length,
    metaDescription: metaDesc.length ? clean($(metaDesc[0]).attr("content") ?? "") || null : null,
    metaDescriptionCount: metaDesc.length,
    canonical: canonicals.length ? (resolve($(canonicals[0]).attr("href"), resolveBase)?.toString() ?? null) : null,
    canonicalCount: canonicals.length,
    robotsMeta: $('meta[name="robots" i]').attr("content")?.toLowerCase() ?? null,
    lang: $("html").attr("lang") ?? null,
    viewport: $('meta[name="viewport" i]').attr("content") ?? null,
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    wordCount: words.length,
    text: text.slice(0, 200_000),
    textExcerpt: text.slice(0, 600),
    contentHash: createHash("sha256").update(text.toLowerCase()).digest("hex"),
    shingles: shingle(text),
    internalLinks: internalLinks.slice(0, 1000),
    externalLinks: externalLinks.slice(0, 500),
    images,
    structuredData: { types: [...types], jsonLdErrors, items },
    hreflang,
    pagination: {
      next: resolve($('link[rel="next" i]').attr("href"), resolveBase)?.toString() ?? null,
      prev: resolve($('link[rel="prev" i]').attr("href"), resolveBase)?.toString() ?? null,
    },
    mixedContent,
    forms,
    telLinks: [...new Set(telLinks)],
    mailtoLinks: [...new Set(mailtoLinks)],
    whatsappLinks: [...new Set(whatsappLinks)],
    socialLinks: [...new Set(socialLinks)],
    ogSiteName: $('meta[property="og:site_name" i]').attr("content")?.trim() || null,
    scriptCount,
    appRootDetected,
    footerText,
  };
}
