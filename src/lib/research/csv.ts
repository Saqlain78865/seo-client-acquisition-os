import Papa from "papaparse";

/**
 * Reads SEO tool exports (Ahrefs, Semrush, Google Search Console, or any similar CSV) and maps
 * their columns to our fields. Values are copied as-is; nothing is filled in or estimated here.
 */

export const IMPORT_KINDS = { KEYWORDS: "Keywords", BACKLINKS: "Referring domains / backlinks", GSC_QUERIES: "Search Console — queries", GSC_PAGES: "Search Console — pages" } as const;
export type ImportKind = keyof typeof IMPORT_KINDS;
export const IMPORT_SOURCES = { AHREFS: "Ahrefs", SEMRUSH: "Semrush", GOOGLE_SEARCH_CONSOLE: "Google Search Console", OTHER: "Other tool" } as const;
export type ImportSource = keyof typeof IMPORT_SOURCES;

export class CsvImportError extends Error {}

/** Decodes UTF-8 (with or without BOM) and UTF-16 LE/BE, which Ahrefs uses for its "Excel" export. */
export function decodeCsv(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const text = buf.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const norm = (h: string) => h.toLowerCase().replace(/[​"']/g, "").replace(/\s+/g, " ").trim();

type FieldSpec = Record<string, string[]>;

const KEYWORD_FIELDS: FieldSpec = {
  keyword: ["keyword", "keywords", "query", "top queries", "search term"],
  volume: ["volume", "search volume", "avg. monthly searches", "avg monthly searches", "sv", "monthly volume"],
  difficulty: ["kd", "keyword difficulty", "difficulty", "keyword difficulty index", "kd %", "kd%"],
  cpc: ["cpc", "cpc (usd)", "cpc usd", "cpc (gbp)", "cpc (eur)", "top of page bid (high range)"],
  position: ["position", "current position", "pos.", "rank", "current rank"],
  url: ["url", "current url", "target url", "landing page", "ranking url"],
  intent: ["intent", "intents", "search intent"],
  country: ["country", "database", "location"],
};

const BACKLINK_FIELDS: FieldSpec = {
  domain: ["domain", "referring domain", "root domain", "source domain", "referring domains"],
  sourceUrl: ["source url", "referring page url", "referring page", "source page url"],
  dr: ["dr", "domain rating"],
  ascore: ["authority score", "ascore", "domain ascore", "page ascore"],
  backlinks: ["links to target", "backlinks", "links", "dofollow links to target", "number of backlinks"],
  dofollow: ["dofollow", "nofollow", "link type"],
  firstSeen: ["first seen", "first_seen", "first seen date"],
};

const GSC_FIELDS: FieldSpec = {
  value: ["top queries", "query", "queries", "top pages", "page", "pages", "url"],
  clicks: ["clicks"],
  impressions: ["impressions"],
  ctr: ["ctr"],
  position: ["position", "average position", "avg. position"],
};

function mapColumns(headers: string[], spec: FieldSpec) {
  const map: Record<string, string> = {};
  const normalised = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const [field, aliases] of Object.entries(spec)) {
    const hit = aliases.map((a) => normalised.find((h) => h.n === a)).find(Boolean) ?? normalised.find((h) => aliases.some((a) => h.n.startsWith(`${a} (`)));
    if (hit) map[field] = hit.raw;
  }
  return map;
}

/** "1,234" → 1234, "5.2%" → 5.2, "$1.20" → 1.2. Ranges ("1K–10K") and blanks are not guessed: they become null. */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "-" || s === "—" || /n\/?a/i.test(s)) return null;
  if (/\d\s*[-–]\s*\d/.test(s.replace(/^-/, ""))) return null;
  const cleaned = s.replace(/[,\s%$£€₨]/g, "").replace(/^(usd|gbp|eur|pkr|rs\.?)/i, "");
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)([km])?$/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) ? n : null;
}

export function detectSource(headers: string[]): ImportSource {
  const h = headers.map(norm);
  if (h.some((x) => x === "top queries" || x === "top pages") && h.includes("impressions")) return "GOOGLE_SEARCH_CONSOLE";
  if (h.includes("kd") || h.includes("dr") || h.includes("domain rating") || h.includes("parent keyword") || h.includes("traffic potential")) return "AHREFS";
  if (h.includes("keyword difficulty") || h.includes("authority score") || h.includes("page ascore") || h.includes("keyword intents") || h.includes("trend")) return "SEMRUSH";
  return "OTHER";
}

export function detectKind(headers: string[]): ImportKind | null {
  const h = headers.map(norm);
  if (h.includes("impressions") && h.includes("clicks")) return h.some((x) => x === "top pages" || x === "page" || x === "pages") ? "GSC_PAGES" : "GSC_QUERIES";
  if (Object.keys(mapColumns(headers, { k: KEYWORD_FIELDS.keyword })).length) return "KEYWORDS";
  if (Object.keys(mapColumns(headers, { d: [...BACKLINK_FIELDS.domain, ...BACKLINK_FIELDS.sourceUrl] })).length) return "BACKLINKS";
  return null;
}

export function readTable(text: string) {
  const parse = (t: string) => Papa.parse<Record<string, string>>(t, { header: true, skipEmptyLines: "greedy", delimitersToGuess: [",", "\t", ";", "|"] });
  const lines = text.trim().split(/\r?\n/);
  let parsed = parse(text.trim());
  // Skip up to 5 lines of preamble when the real header row comes later.
  if (!detectKind((parsed.meta.fields ?? []).filter(Boolean))) {
    for (let i = 1; i <= Math.min(5, lines.length - 2); i++) {
      const p = parse(lines.slice(i).join("\n"));
      if (detectKind((p.meta.fields ?? []).filter(Boolean))) {
        parsed = p;
        break;
      }
    }
  }
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  if (headers.length < 2) throw new CsvImportError("The file has no recognisable header row.");
  return { headers, rows: parsed.data };
}

const MAX_ROWS = 20_000;

export type KeywordRow = { keyword: string; volume: number | null; difficulty: number | null; cpc: number | null; position: number | null; url: string | null; intent: string | null; country: string | null };
export type BacklinkRow = { domain: string; authority: number | null; backlinks: number | null; dofollow: boolean | null; firstSeen: Date | null };
export type GscRow = { value: string; clicks: number; impressions: number; ctr: number | null; position: number | null };

export type ParsedImport =
  | { kind: "KEYWORDS"; source: ImportSource; columnMap: Record<string, string>; rows: KeywordRow[]; skipped: number }
  | { kind: "BACKLINKS"; source: ImportSource; columnMap: Record<string, string>; rows: BacklinkRow[]; skipped: number; authorityMetric: string | null }
  | { kind: "GSC_QUERIES" | "GSC_PAGES"; source: ImportSource; columnMap: Record<string, string>; rows: GscRow[]; skipped: number };

function hostOf(v: string) {
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `http://${v}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function parseImport(text: string, opts: { kind?: ImportKind; source?: ImportSource } = {}): ParsedImport {
  const { headers, rows } = readTable(text);
  if (rows.length > MAX_ROWS) throw new CsvImportError(`The file has ${rows.length} rows; the limit is ${MAX_ROWS}. Filter it in the tool first.`);
  const kind = opts.kind ?? detectKind(headers);
  if (!kind) throw new CsvImportError(`Could not tell what this file contains. Columns found: ${headers.slice(0, 8).join(", ")}`);
  const source = opts.source ?? detectSource(headers);

  if (kind === "KEYWORDS") {
    const map = mapColumns(headers, KEYWORD_FIELDS);
    if (!map.keyword) throw new CsvImportError("No keyword column found (expected “Keyword”).");
    const seen = new Set<string>();
    const out: KeywordRow[] = [];
    let skipped = 0;
    for (const r of rows) {
      const keyword = String(r[map.keyword] ?? "").trim().toLowerCase().slice(0, 300);
      if (!keyword || seen.has(keyword)) {
        skipped++;
        continue;
      }
      seen.add(keyword);
      const pos = map.position ? parseNumber(r[map.position]) : null;
      out.push({
        keyword,
        volume: map.volume ? parseNumber(r[map.volume]) : null,
        difficulty: map.difficulty ? parseNumber(r[map.difficulty]) : null,
        cpc: map.cpc ? parseNumber(r[map.cpc]) : null,
        position: pos != null && pos > 0 ? pos : null,
        url: map.url ? String(r[map.url] ?? "").trim() || null : null,
        intent: map.intent ? String(r[map.intent] ?? "").trim() || null : null,
        country: map.country ? String(r[map.country] ?? "").trim() || null : null,
      });
    }
    return { kind, source, columnMap: map, rows: out, skipped };
  }

  if (kind === "BACKLINKS") {
    const map = mapColumns(headers, BACKLINK_FIELDS);
    if (!map.domain && !map.sourceUrl) throw new CsvImportError("No referring domain or source URL column found.");
    const authorityCol = map.dr ?? map.ascore ?? null;
    const authorityMetric = map.dr ? "Ahrefs Domain Rating (DR)" : map.ascore ? `Semrush ${map.ascore}` : null;
    // Per-link exports (Semrush backlinks) are aggregated to one row per referring domain.
    const byDomain = new Map<string, BacklinkRow>();
    let skipped = 0;
    for (const r of rows) {
      const domain = hostOf(String(r[map.domain ?? map.sourceUrl!] ?? "").trim());
      if (!domain) {
        skipped++;
        continue;
      }
      const authority = authorityCol ? parseNumber(r[authorityCol]) : null;
      const links = map.backlinks ? parseNumber(r[map.backlinks]) : map.domain ? null : 1;
      const dofollowRaw = map.dofollow ? String(r[map.dofollow] ?? "").toLowerCase() : "";
      const dofollow = !map.dofollow ? null : /nofollow|^false$|^0$/.test(dofollowRaw) ? false : /dofollow|follow|^true$|^1$|^\d+$/.test(dofollowRaw) ? true : null;
      const first = map.firstSeen ? new Date(String(r[map.firstSeen])) : null;
      const prev = byDomain.get(domain);
      if (prev) {
        prev.backlinks = (prev.backlinks ?? 0) + (links ?? 0) || prev.backlinks;
        if (authority != null) prev.authority = Math.max(prev.authority ?? 0, authority);
        if (dofollow) prev.dofollow = true;
        continue;
      }
      byDomain.set(domain, { domain, authority, backlinks: links, dofollow, firstSeen: first && !isNaN(first.getTime()) ? first : null });
    }
    return { kind, source, columnMap: map, rows: [...byDomain.values()], skipped, authorityMetric };
  }

  const map = mapColumns(headers, GSC_FIELDS);
  if (!map.value || !map.clicks || !map.impressions) throw new CsvImportError("Expected Search Console columns: query or page, Clicks, Impressions.");
  const out: GscRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const value = String(r[map.value] ?? "").trim();
    const clicks = parseNumber(r[map.clicks]);
    const impressions = parseNumber(r[map.impressions]);
    if (!value || clicks == null || impressions == null) {
      skipped++;
      continue;
    }
    out.push({ value: value.slice(0, 2000), clicks, impressions, ctr: map.ctr ? parseNumber(r[map.ctr]) : null, position: map.position ? parseNumber(r[map.position]) : null });
  }
  return { kind, source: "GOOGLE_SEARCH_CONSOLE", columnMap: map, rows: out, skipped };
}
