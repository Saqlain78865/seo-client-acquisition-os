import type { ExtractedPage } from "./extract";

export const PAGE_TYPES = [
  "HOMEPAGE",
  "SERVICE",
  "LOCATION",
  "PRODUCT",
  "CATEGORY",
  "BLOG_ARTICLE",
  "ABOUT",
  "CONTACT",
  "PRICING",
  "FAQ",
  "BOOKING",
  "OTHER",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  HOMEPAGE: "Homepage",
  SERVICE: "Service page",
  LOCATION: "Location page",
  PRODUCT: "Product / tour page",
  CATEGORY: "Category page",
  BLOG_ARTICLE: "Blog article",
  ABOUT: "About page",
  CONTACT: "Contact page",
  PRICING: "Pricing page",
  FAQ: "FAQ",
  BOOKING: "Booking / conversion page",
  OTHER: "Other",
};

const has = (s: string, re: RegExp) => re.test(s);

/**
 * Scores each page type from content and structure: structured data, headings, title, forms
 * and text. The URL path is one weak signal among many, never the only one.
 */
export function classifyPage(url: string, page: ExtractedPage, homepageUrl: string): { type: PageType; scores: Partial<Record<PageType, number>> } {
  const u = new URL(url);
  const home = new URL(homepageUrl);
  if ((u.pathname === "/" || u.pathname === "") && !u.search && u.hostname.replace(/^www\./, "") === home.hostname.replace(/^www\./, "")) {
    return { type: "HOMEPAGE", scores: { HOMEPAGE: 100 } };
  }

  const path = decodeURIComponent(u.pathname).toLowerCase();
  const title = `${page.title ?? ""} ${page.h1.join(" ")}`.toLowerCase();
  const headings = page.headings.map((h) => h.text.toLowerCase()).join(" | ");
  const text = page.text.slice(0, 20_000).toLowerCase();
  const types = page.structuredData.types.map((t) => t.toLowerCase());
  const s: Partial<Record<PageType, number>> = {};
  const add = (t: PageType, n: number) => (s[t] = (s[t] ?? 0) + n);

  // Structured data — strongest signal.
  if (types.some((t) => ["blogposting", "article", "newsarticle"].includes(t))) add("BLOG_ARTICLE", 6);
  if (types.includes("faqpage")) add("FAQ", 6);
  if (types.some((t) => ["product", "touristtrip", "trip", "event"].includes(t))) add("PRODUCT", 5);
  if (types.includes("service")) add("SERVICE", 4);
  if (types.includes("contactpage")) add("CONTACT", 6);
  if (types.includes("aboutpage")) add("ABOUT", 6);
  if (types.includes("collectionpage") || types.includes("itemlist")) add("CATEGORY", 3);
  if (types.includes("offercatalog")) add("PRICING", 2);

  // Title / H1.
  if (has(title, /\b(contact|get in touch|reach us)\b/)) add("CONTACT", 4);
  if (has(title, /\b(about|our story|who we are|our team)\b/)) add("ABOUT", 4);
  if (has(title, /\b(pricing|prices|packages|plans|rates|fees)\b/)) add("PRICING", 4);
  if (has(title, /\b(faq|frequently asked|questions)\b/)) add("FAQ", 4);
  if (has(title, /\b(book|booking|appointment|reserve|schedule a)\b/)) add("BOOKING", 3);
  if (has(title, /\b(services?|solutions|treatments?|repair|installation|cleaning|consulting)\b/)) add("SERVICE", 2);
  // "Plumber in Leeds" is a location page; "Sustainable tourism in Dubai" under /about is not.
  if ((has(title, /\b(in|near)\s+[a-z][a-z\s]{2,30}$/) && !/\/(about|blog|news|careers?)(\/|$|-)/.test(path)) || has(title, /\b(areas? we serve|service areas?|locations?)\b/)) add("LOCATION", 3);
  if (has(title, /\b(tours?|packages?|trips?|products?|buy|shop|rides?|rentals?|hire|safaris?|experiences?|adventures?|excursions?|cruises?|classes|courses?|lessons?)\b/)) add("PRODUCT", 2);
  if (has(title, /\b(blog|news|articles|insights)\b/) && page.wordCount < 400) add("CATEGORY", 2);

  // Structure.
  const contactForm = page.forms.some((f) => f.hasTextarea && f.hasEmailField && !f.hasPassword);
  if (contactForm) add("CONTACT", 2);
  if (page.telLinks.length + page.mailtoLinks.length >= 2 && page.wordCount < 600) add("CONTACT", 1);
  if (page.forms.some((f) => f.fields.some((x) => x === "date" || x === "datetime-local")) || has(text, /\b(book now|check availability|select a date)\b/)) add("BOOKING", 2);
  const questionHeadings = page.headings.filter((h) => h.text.trim().endsWith("?")).length;
  if (questionHeadings >= 4) add("FAQ", 3);
  if ((text.match(/[$€£₨]\s?\d|\d\s?(usd|eur|gbp|pkr|aed)\b|\bper month\b|\/mo\b/g) ?? []).length >= 3) add("PRICING", 2);
  if (has(text, /\b(published|posted on|min read|written by)\b/) && page.wordCount > 400) add("BLOG_ARTICLE", 2);
  if (page.internalLinks.length > 40 && page.wordCount < 350) add("CATEGORY", 1);
  if (has(headings, /\b(our process|why choose|benefits|what we offer|how it works)\b/)) add("SERVICE", 1);

  // URL path — weak.
  if (/\/(contact|contact-us|get-in-touch)\b/.test(path)) add("CONTACT", 1.5);
  if (/\/(about|about-us|our-story|team)\b/.test(path)) add("ABOUT", 1.5);
  if (/\/(blog|news|articles|insights)\/.+/.test(path)) add("BLOG_ARTICLE", 1.5);
  if (/\/(blog|news|category|tag|shop|collections?)\/?$/.test(path)) add("CATEGORY", 1.5);
  if (/\/(services?|treatments?|solutions)\b/.test(path)) add("SERVICE", 1.5);
  if (/\/(locations?|areas?|service-areas?|city|cities)\b/.test(path)) add("LOCATION", 1.5);
  if (/\/(pricing|prices|packages|plans)\b/.test(path)) add("PRICING", 1.5);
  if (/\/(faq|faqs|help)\b/.test(path)) add("FAQ", 1.5);
  if (/\/(book|booking|appointment|reserve)\b/.test(path)) add("BOOKING", 1.5);
  if (/\/(products?|tours?|trips?|item)\//.test(path)) add("PRODUCT", 1.5);
  else if (/\b(tours?|rides?|rentals?|hire|safaris?|experiences?|adventures?|excursions?|cruises?|packages?|trips?)\b/.test(path.replace(/[-_]/g, " "))) add("PRODUCT", 1);

  let best: PageType = "OTHER";
  let bestScore = 2.5; // below this the evidence is too weak to label
  for (const [t, v] of Object.entries(s) as [PageType, number][]) {
    if (v > bestScore) {
      best = t;
      bestScore = v;
    }
  }
  // Fallback: a substantial inner page with prices or a booking call-to-action is selling something.
  if (best === "OTHER" && page.wordCount >= 250 && (/[$€£₨]\s?\d|\d\s?(usd|eur|gbp|pkr|aed|inr)\b|\b(aed|usd|pkr)\s?\d/.test(text) || has(text, /\b(book now|reserve now|buy now|order now)\b/))) {
    best = "PRODUCT";
  }
  return { type: best, scores: s };
}

/** "/de/", "/fr-ca/page" and similar: the two-letter language prefix of a path, if any. */
export function languagePrefix(url: string): string | null {
  try {
    return new URL(url).pathname.match(/^\/([a-z]{2})(?:-[a-z]{2,4})?(?:\/|$)/i)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** True when a page is a translation of the site (another language than the homepage). */
export function isOtherLanguage(url: string, homepageUrl: string | null | undefined, lang?: string | null, homeLang?: string | null) {
  const a = (lang ?? "").slice(0, 2).toLowerCase();
  const b = (homeLang ?? "").slice(0, 2).toLowerCase();
  if (a && b && a !== b) return true;
  return languagePrefix(url) !== (homepageUrl ? languagePrefix(homepageUrl) : null);
}
