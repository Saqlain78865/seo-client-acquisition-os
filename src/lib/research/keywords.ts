/**
 * Keyword research helpers. Pure functions: they classify, group and map keywords, but never
 * create metrics. Volume, difficulty and CPC only ever come from imported data.
 */

export type Intent = "TRANSACTIONAL" | "COMMERCIAL" | "INFORMATIONAL" | "NAVIGATIONAL";
export const INTENT_LABELS: Record<Intent, string> = { TRANSACTIONAL: "Transactional", COMMERCIAL: "Commercial", INFORMATIONAL: "Informational", NAVIGATIONAL: "Navigational" };
export const FUNNEL: Record<Intent, string> = { TRANSACTIONAL: "Bottom (ready to act)", COMMERCIAL: "Middle (comparing)", INFORMATIONAL: "Top (learning)", NAVIGATIONAL: "Brand / navigation" };

const INFO = /^(how|what|why|when|where|who|which|can|does|do|is|are|should|will)\b|\b(guide|tips|ideas|meaning|definition|examples?|tutorial|vs\.? difference|benefits|symptoms|causes)\b/;
const COMMERCIAL = /\b(best|top|review|reviews|compare|comparison|vs|versus|alternatives?|affordable|cheapest|recommended|rated)\b/;
const TRANSACTIONAL = /\b(buy|price|prices|pricing|cost|costs|cheap|hire|book|booking|appointment|quote|order|near me|for sale|deal|deals|discount|services?|company|agency|contractor|clinic|emergency|repair|install(ation)?)\b/;
const NAVIGATIONAL = /\b(login|log in|sign in|website|official|contact number|phone number|address|hours)\b/;

/** Rule-based intent from wording; imported intent labels (e.g. Semrush) take precedence when present. */
export function classifyIntent(keyword: string, brandTerms: string[] = [], imported?: string | null): Intent {
  // Tools may list several intents ("Informational, Commercial"); the first one is the main intent.
  const fromTool = imported?.toLowerCase() ?? "";
  const toolIntent = (["transactional", "commercial", "informational", "navigational"] as const)
    .map((i) => ({ i, at: fromTool.indexOf(i) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (toolIntent) return toolIntent.i.toUpperCase() as Intent;
  const k = keyword.toLowerCase();
  // Brand terms are whole brand names ("bright smile dental", "brightsmile"), not single generic words.
  const compact = k.replace(/[^\p{L}\p{N}]/gu, "");
  if (brandTerms.some((b) => b.length > 3 && (k.includes(b.toLowerCase()) || compact.includes(b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")))) || NAVIGATIONAL.test(k)) return "NAVIGATIONAL";
  if (INFO.test(k)) return "INFORMATIONAL";
  if (COMMERCIAL.test(k)) return "COMMERCIAL";
  if (TRANSACTIONAL.test(k)) return "TRANSACTIONAL";
  // Short service phrases ("dentist leeds") are usually local, ready-to-act searches.
  return k.split(/\s+/).length <= 4 ? "TRANSACTIONAL" : "INFORMATIONAL";
}

const STOP = new Set(["the", "a", "an", "and", "or", "for", "in", "of", "to", "near", "me", "my", "best", "top", "with", "on", "at", "by", "is", "are", "how", "what", "much", "does", "do", "cost", "price", "prices", "cheap", "affordable"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/https?:\/\/[^/]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

function overlap(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const inter = new Set(a.filter((x) => sb.has(x))).size;
  return inter / new Set([...a, ...b]).size;
}

/** Seed ideas from the business's own services and locations. These have no metrics and are labelled as ideas. */
/** "Dubai ATV Ride – Morning Quad Bike Adventure from AED 150" → "dubai atv ride". */
export function cleanServicePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s[|–—:·]\s|\s-\s|\s\|/)[0]
    .replace(/[$€£₨]\s?\d[\d,.]*|\b(aed|usd|pkr|eur|gbp|inr|rs\.?)\s?\d[\d,.]*|\d[\d,.]*\s?(aed|usd|pkr|eur|gbp|inr)\b/g, " ")
    .replace(/\b(from|starting at|starting from|only|just)\s*$/g, "")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Lahbab Desert, Dubai, AE" → "lahbab desert"; "Morning Buggy Safari in Dubai" → "dubai". */
export function cleanLocation(raw: string): string {
  let x = raw.toLowerCase().split(",")[0].trim();
  const m = x.match(/\b(?:in|near)\s+([\p{L}][\p{L}\s'-]{1,30})$/u);
  if (m) x = m[1].trim();
  return x.replace(/\s+/g, " ");
}

export function generateSeeds(services: string[], locations: string[]): string[] {
  const words = (s: string) => s.split(" ").length;
  const svc = [...new Set(services.map(cleanServicePhrase).filter((s) => s.length >= 3 && s.length <= 50 && words(s) <= 6))].slice(0, 10);
  const loc = [...new Set(locations.map(cleanLocation).filter((l) => l.length >= 3 && words(l) <= 3))].slice(0, 3);
  const out = new Set<string>();
  // A few useful forms per service, not every combination: the main phrase, price, "best" and "near me",
  // plus the service with each place — unless the phrase already names a place.
  for (const s of svc) {
    out.add(s);
    out.add(`${s} cost`);
    out.add(`best ${s}`);
    const hasPlace = /\b(in|near)\s/.test(s) || loc.some((l) => s.includes(l));
    if (!hasPlace) out.add(`${s} near me`);
    for (const l of hasPlace ? [] : loc) out.add(`${s} ${l}`);
  }
  return [...out].slice(0, 80);
}

export type KeywordInput = { id: string; keyword: string; volume: number | null; difficulty: number | null };
export type Cluster = { name: string; keywordIds: string[]; tokens: string[] };

/** Greedy clustering by shared meaningful words: keywords join the cluster whose core words they overlap most. */
export function clusterKeywords(keywords: KeywordInput[], threshold = 0.5): Cluster[] {
  const sorted = [...keywords].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.keyword.length - b.keyword.length);
  const clusters: Cluster[] = [];
  for (const k of sorted) {
    const t = tokens(k.keyword);
    let best: Cluster | null = null;
    let bestScore = 0;
    for (const c of clusters) {
      const score = overlap(t, c.tokens);
      // A keyword that contains all of a cluster's core words belongs to it (e.g. "dental implants cost" → "dental implants").
      const contains = c.tokens.every((x) => t.includes(x)) ? 1 : 0;
      const s = Math.max(score, contains * 0.75);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    if (best && bestScore >= threshold) best.keywordIds.push(k.id);
    else clusters.push({ name: k.keyword, keywordIds: [k.id], tokens: t.length ? t : [k.keyword.toLowerCase()] });
  }
  return clusters;
}

export type PageForMapping = { url: string; title: string | null; h1: string | null; pageType: string | null };
export type Mapping = { url: string | null; score: number; competing: string[] };

/** Finds the existing page that best matches a cluster, and other pages that target nearly the same words. */
export function mapClusterToPage(clusterTokens: string[], pages: PageForMapping[], minScore = 0.34): Mapping {
  const scored = pages
    .map((p) => {
      const pageTokens = [...new Set([...tokens(p.title ?? ""), ...tokens(p.h1 ?? ""), ...tokens(decodeURIComponent(new URL(p.url).pathname))])];
      const covered = clusterTokens.filter((t) => pageTokens.includes(t)).length / Math.max(clusterTokens.length, 1);
      return { url: p.url, score: covered };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < minScore) return { url: null, score: best?.score ?? 0, competing: [] };
  // Only pages that match the cluster exactly as well as the best page compete with it.
  const competing = scored.filter((s) => s.url !== best.url && s.score >= best.score && s.score >= 0.67).map((s) => s.url);
  return { url: best.url, score: best.score, competing };
}

export function recommendedPageType(intent: Intent, keyword: string, locations: string[]) {
  const k = keyword.toLowerCase();
  if (intent === "INFORMATIONAL") return "BLOG_ARTICLE";
  if (intent === "NAVIGATIONAL") return "CONTACT";
  if (locations.some((l) => l && k.includes(l.toLowerCase().split(",")[0].trim()))) return "LOCATION";
  if (/\b(price|pricing|cost)\b/.test(k)) return "PRICING";
  return "SERVICE";
}

/**
 * Priority 0–100 from transparent parts: intent value, measured or estimated demand, difficulty,
 * whether a page exists, and "striking distance" positions. Missing data scores neutrally — never guessed.
 */
export function keywordPriority(k: { intent: Intent; volume: number | null; difficulty: number | null; position: number | null; hasPage: boolean }) {
  const parts: Record<string, number> = {};
  parts.intent = { TRANSACTIONAL: 35, COMMERCIAL: 28, INFORMATIONAL: 15, NAVIGATIONAL: 5 }[k.intent];
  parts.demand = k.volume == null ? 10 : Math.min(30, Math.round(Math.log10(k.volume + 1) * 10));
  parts.difficulty = k.difficulty == null ? 0 : -Math.round((Math.min(k.difficulty, 100) / 100) * 15);
  parts.gap = k.hasPage ? 0 : 10;
  parts.strikingDistance = k.position != null && k.position >= 4 && k.position <= 20 ? 15 : 0;
  const score = Math.max(0, Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0) + 10));
  return { score, parts };
}
