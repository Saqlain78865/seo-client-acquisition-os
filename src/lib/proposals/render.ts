import {
  SERVICES,
  type Branding,
  type Deliverable,
  type ProposalFinding,
  type ProposalGbp,
  type ProposalKeyword,
  type ProposalReview,
  type ProposalScreens,
  type RoadmapPhase,
  type ServiceKey,
} from "./types";
import { resolvePalette } from "./theme";

/**
 * Renders a proposal version to a standalone, print-ready HTML document. The same HTML is used
 * for the in-app preview, the client's link and the PDF, so what you preview is what the client
 * receives. All user-provided text is escaped; the document loads no external resources — images
 * (logo, screenshots) are embedded as data URIs.
 */

export type RenderVersion = {
  title: string;
  version: number;
  proposalDate: Date;
  validUntil: Date | null;
  currency: string;
  monthlyPrice: number | null;
  setupFee: number | null;
  durationMonths: number;
  paymentTerms: string | null;
  theme: string;
  services: ServiceKey[];
  deliverables: Deliverable[];
  clientNotes: string | null;
  includeAppendix: boolean;
  branding: Branding;
  sections: { key: string; title: string; body: string; included: boolean; data: unknown }[];
  /** Screenshot storage key → data URI, filled in by the service before rendering. */
  images?: Record<string, string>;
};

export type RenderClient = { businessName: string; websiteUrl: string; contactName: string | null };

type SectionData = {
  findings?: ProposalFinding[];
  phases?: RoadmapPhase[];
  keywords?: ProposalKeyword[];
  screens?: ProposalScreens;
  gbp?: ProposalGbp;
  reviews?: ProposalReview[];
};

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only http(s) links are emitted; anything else (javascript:, data:) is rendered as plain text. */
function link(url: string, label = url) {
  return /^https?:\/\//i.test(url) ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

const inline = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1">$1</a>');

type Block = { type: "p"; lines: string[] } | { type: "ul"; items: string[] };

/** Splits section text into paragraphs and bullet lists ("- " lines). */
function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const firstBullet = lines.findIndex((l) => /^\s*-\s+/.test(l));
    if (firstBullet === -1) {
      out.push({ type: "p", lines });
      continue;
    }
    if (firstBullet > 0) out.push({ type: "p", lines: lines.slice(0, firstBullet) });
    const rest = lines.slice(firstBullet);
    if (rest.every((l) => /^\s*-\s+/.test(l))) out.push({ type: "ul", items: rest.map((l) => l.replace(/^\s*-\s+/, "")) });
    else out.push({ type: "p", lines: rest });
  }
  return out;
}

/** Minimal, safe markup: blank line = paragraph, "- " = bullet, **bold**, bare http(s) URLs become links. */
export function renderText(text: string) {
  return parseBlocks(text)
    .map((b) => (b.type === "p" ? `<p>${b.lines.map(inline).join("<br>")}</p>` : `<ul class="checks">${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`))
    .join("");
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "**Title** — detail" bullets become { title, detail } for tiles and steps. */
function featureItems(items: string[]) {
  const parsed = items.map((i) => i.match(/^\*\*(.+?)\*\*\s*(?:[—–:,-]\s*)?(.*)$/));
  return parsed.every(Boolean) ? parsed.map((m) => ({ title: m![1], detail: capitalise(m![2].trim()) })) : null;
}

/** Long audit text for a client: full URLs shortened to their path, and capped in length. */
function tidy(text: string, max = 320) {
  const short = text.replace(/https?:\/\/[^\s,;)]+/g, (u) => {
    try {
      const p = new URL(u).pathname;
      return p.length > 40 ? `${p.slice(0, 38)}…` : p || "/";
    } catch {
      return u;
    }
  });
  return short.length > max ? `${short.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : short;
}

// ───────────── Icons (inline SVG, stroke) ─────────────

const ICON_PATHS: Record<string, string> = {
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  trending: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.1a4 4 0 0 1 0 7.8M21 21v-2a4 4 0 0 0-3-3.9"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  cursor: '<path d="m4 4 7 17 2.5-7.5L21 11z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17V9M13 17V5M18 17v-3"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (name: string, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ICON_PATHS.info}</svg>`;

const SECTION_ICONS: Record<string, string> = {
  executive_summary: "rocket",
  opportunity: "trending",
  business_context: "users",
  key_findings: "alert",
  audit_overview: "monitor",
  gbp: "pin",
  reputation: "shield",
  what_you_get: "gift",
  how_we_work: "cog",
  technical: "wrench",
  onpage: "file",
  content: "pen",
  keywords: "search",
  competitors: "target",
  local: "pin",
  offpage: "link",
  conversion: "cursor",
  roadmap: "calendar",
  deliverables: "list",
  kpis: "chart",
  why_us: "star",
  client_responsibilities: "key",
  exclusions: "ban",
  timeline: "clock",
  assumptions: "info",
  next_steps: "flag",
  acceptance: "pen",
  appendix: "layers",
};

const SERVICE_ICONS: Record<ServiceKey, string> = {
  TECHNICAL: "wrench",
  ONPAGE: "file",
  CONTENT: "pen",
  KEYWORDS: "search",
  LOCAL: "pin",
  OFFPAGE: "link",
  CRO: "cursor",
  REPUTATION: "shield",
  REPORTING: "chart",
};

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// ───────────── Building blocks ─────────────

function stars(rating: number, size = 14) {
  return `<span class="stars" aria-label="${rating.toFixed(1)} out of 5">${[1, 2, 3, 4, 5]
    .map((i) => {
      const fill = rating >= i - 0.25 ? 1 : rating >= i - 0.75 ? 0.5 : 0;
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" fill="${fill === 1 ? "#f59e0b" : fill ? "url(#half)" : "#e2e8f0"}" stroke="#f59e0b" stroke-width="${fill ? 0 : 1.2}"/></svg>`;
    })
    .join("")}</span>`;
}

function browserFrame(src: string, caption?: string) {
  return `<figure class="browser"><div class="bar"><i></i><i></i><i></i></div><img src="${escapeHtml(src)}" alt="${escapeHtml(caption ?? "Screenshot")}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}

function phoneFrame(src: string) {
  return `<figure class="phone"><div class="notch"></div><img src="${escapeHtml(src)}" alt="Website on a phone"></figure>`;
}

const WEIGHT: Record<string, number> = { CRITICAL: 14, HIGH: 8, MEDIUM: 4, LOW: 1.5, OPPORTUNITY: 1, NEEDS_VERIFICATION: 0 };

/** Snapshot numbers, counted from the findings in the proposal (nothing invented). */
function snapshot(v: RenderVersion) {
  const findingsOf = (key: string) => ((v.sections.find((s) => s.key === key)?.data ?? {}) as SectionData).findings ?? [];
  const all = findingsOf("appendix").length ? findingsOf("appendix") : findingsOf("key_findings");
  const actionable = all.filter((f) => f.severity !== "NEEDS_VERIFICATION");
  if (!actionable.length) return null;
  const score = Math.round(Math.min(97, Math.max(12, 100 - actionable.reduce((s, f) => s + (WEIGHT[f.severity] ?? 2), 0))));
  const byCat = new Map<string, number>();
  for (const f of actionable) if (f.category && f.severity !== "OPPORTUNITY") byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
  return {
    score,
    verdict: score < 45 ? "Needs urgent attention" : score < 70 ? "Big room to grow" : "Good foundations",
    tone: score < 45 ? "#dc2626" : score < 70 ? "#d97706" : "#16a34a",
    issues: actionable.filter((f) => f.severity !== "OPPORTUNITY").length,
    high: actionable.filter((f) => f.priority === "High").length,
    opportunities: actionable.filter((f) => f.severity === "OPPORTUNITY").length,
    categories: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    top: findingsOf("key_findings").filter((f) => f.severity !== "NEEDS_VERIFICATION").slice(0, 3),
  };
}

function scoreRing(score: number, tone: string) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 128 128" width="150" height="150"><circle cx="64" cy="64" r="${r}" fill="none" stroke="#eef1f6" stroke-width="12"/><circle cx="64" cy="64" r="${r}" fill="none" stroke="${tone}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${((c * score) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 64 64)"/><text x="64" y="62" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">${score}</text><text x="64" y="84" text-anchor="middle" font-size="11" fill="#64748b">out of 100</text></svg>`;
}

function findingCard(f: ProposalFinding, img: string | null, compact = false) {
  const tone = f.priority === "High" ? "high" : f.priority === "Medium" ? "medium" : "low";
  const text = `
      <div class="fgrid">
        <div><h4>${icon("search", "mini")}What we found</h4><p>${escapeHtml(tidy(f.observed, compact ? 220 : 320))}</p>${f.where.length && !compact ? `<p class="where">${f.where.slice(0, 3).map((u) => link(u, tidy(u, 70))).join("<br>")}</p>` : ""}</div>
        ${f.whyItMatters ? `<div><h4>${icon("alert", "mini")}Why it matters</h4><p>${escapeHtml(tidy(f.whyItMatters, compact ? 220 : 400))}</p></div>` : ""}
        <div class="fix"><h4>${icon("check", "mini")}How we fix it</h4><p>${escapeHtml(f.solution)}</p></div>
      </div>`;
  return `<article class="finding ${tone} ${compact ? "compact" : ""}">
    <header><span class="pill ${tone}">${escapeHtml(f.priority)} priority</span>${f.category ? `<span class="tag">${escapeHtml(f.category)}</span>` : ""}${f.severity === "NEEDS_VERIFICATION" ? '<span class="tag">Needs data</span>' : ""}<span class="when">${icon("calendar", "mini")}${escapeHtml(f.period)}</span></header>
    <h3>${escapeHtml(f.title)}</h3>
    ${img && !compact ? `<div class="with-shot">${text}${browserFrame(img, "Screenshot from your website")}</div>` : text}
    ${!compact && f.evidence ? `<p class="evidence"><b>Evidence:</b> ${escapeHtml(tidy(f.evidence, 220))}</p>` : ""}
  </article>`;
}

const INTENT_TEXT: Record<string, string> = {
  TRANSACTIONAL: "Ready to buy or book",
  COMMERCIAL: "Comparing options",
  INFORMATIONAL: "Looking for information",
  NAVIGATIONAL: "Looking for a business",
};

function pagePath(url: string) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function keywordTable(keywords: ProposalKeyword[]) {
  const rows = keywords
    .map((k) => {
      const volume = k.volume != null ? `${k.volume.toLocaleString("en-US")}${k.volumeIsEstimate ? " <span class=\"muted\">(est.)</span>" : ""}` : `<span class="muted">To be measured</span>`;
      const page = k.targetUrl ? `Improve ${link(k.targetUrl, pagePath(k.targetUrl))}` : k.suggestedPage ? `New ${escapeHtml(k.suggestedPage.toLowerCase())}` : `<span class="muted">Decided in month 1</span>`;
      return `<tr><td><strong>${escapeHtml(k.keyword)}</strong></td><td><span class="intent">${escapeHtml(INTENT_TEXT[k.intent ?? ""] ?? "—")}</span></td><td class="num">${volume}</td><td>${page}</td></tr>`;
    })
    .join("");
  const sources = [...new Set(keywords.map((k) => k.source))].slice(0, 4);
  return `<table class="data"><thead><tr><th>Search</th><th>What the searcher wants</th><th class="num">Monthly searches</th><th>Page that will target it</th></tr></thead><tbody>${rows}</tbody></table><p class="muted small">Sources: ${escapeHtml(sources.join("; "))}. Search numbers are estimates, not guarantees of traffic.</p>`;
}

function gbpBlock(g: ProposalGbp) {
  const ranks = g.rankings.length
    ? `<table class="data"><thead><tr><th>Google Maps search</th><th class="num">Position today</th></tr></thead><tbody>${g.rankings
        .map((r) => `<tr><td>“${escapeHtml(r.query)}”</td><td class="num"><span class="rank ${r.position == null ? "bad" : r.position <= 3 ? "good" : "mid"}">${r.position == null ? `Not in top ${r.total || 20}` : `#${r.position}`}</span></td></tr>`)
        .join("")}</tbody></table>`
    : "";
  const issues = g.issues.length
    ? `<ul class="issues">${g.issues.map((i) => `<li class="${i.severity === "CRITICAL" || i.severity === "HIGH" ? "high" : "medium"}"><b>${escapeHtml(i.title)}</b><span>${escapeHtml(i.fix)}</span></li>`).join("")}</ul>`
    : "";
  return `<div class="gbp">
    <div class="gbp-card">
      <p class="cat">${escapeHtml(g.category ?? "Google Business Profile")}</p>
      <p class="name">${escapeHtml(g.name)}</p>
      ${g.rating != null ? `<p class="rating"><b>${g.rating.toFixed(1)}</b>${stars(g.rating, 16)}</p><p class="count">${g.reviewCount ?? 0} Google reviews</p>` : ""}
      <div class="facts">
        <span>${g.photoCount == null ? "—" : g.source === "PLACES_API" && g.photoCount >= 10 ? "10+" : g.photoCount}<small>photos</small></span>
        <span>${g.hasHours == null ? "—" : g.hasHours ? "Yes" : "No"}<small>opening hours</small></span>
      </div>
    </div>
    <div class="gbp-detail">${ranks}${issues}</div>
  </div>`;
}

function reviewCards(reviews: ProposalReview[]) {
  return `<div class="reviews">${reviews
    .map((r) => `<blockquote>${stars(r.rating, 13)}<p>“${escapeHtml(r.text)}”</p>${r.when ? `<cite>Google review · ${escapeHtml(r.when)}</cite>` : "<cite>Google review</cite>"}</blockquote>`)
    .join("")}</div>`;
}

/** Section body with a special layout for some sections; plain paragraphs and check lists otherwise. */
function sectionBody(key: string, text: string) {
  const blocks = parseBlocks(text);
  let leadUsed = false;
  return blocks
    .map((b) => {
      if (b.type === "p") {
        const html = `<p${!leadUsed && ["executive_summary", "opportunity", "gbp", "reputation", "audit_overview", "how_we_work"].includes(key) ? ' class="lead"' : ""}>${b.lines.map(inline).join("<br>")}</p>`;
        leadUsed = true;
        return html;
      }
      const items = featureItems(b.items);
      if (items && key === "how_we_work") {
        return `<ol class="steps">${items.map((x, i) => `<li><span class="n">${i + 1}</span><b>${escapeHtml(x.title)}</b><p>${inline(x.detail)}</p></li>`).join("")}</ol>`;
      }
      if (items && key === "next_steps") {
        return `<ol class="timeline">${items.map((x) => `<li><b>${escapeHtml(x.title)}</b><p>${inline(x.detail)}</p></li>`).join("")}</ol>`;
      }
      if (items && ["what_you_get", "why_us", "reputation"].includes(key)) {
        const ic = key === "why_us" ? "star" : key === "reputation" ? "shield" : "check";
        return `<div class="tiles">${items.map((x) => `<div class="tile">${icon(ic, "tic")}<b>${escapeHtml(x.title)}</b><p>${inline(x.detail)}</p></div>`).join("")}</div>`;
      }
      return `<ul class="checks">${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    })
    .join("");
}

function sectionExtras(key: string, data: unknown, v: RenderVersion, client: RenderClient) {
  const d = (data ?? {}) as SectionData;
  const img = (k: string | null | undefined) => (k ? (v.images?.[k] ?? null) : null);
  if (key === "keywords" && d.keywords?.length) return keywordTable(d.keywords);
  if (key === "key_findings" && d.findings?.length) return d.findings.map((f) => findingCard(f, img(f.screenshot))).join("");
  if (key === "appendix" && d.findings?.length) return d.findings.map((f) => findingCard(f, null, true)).join("");
  if (key === "audit_overview" && d.screens) {
    const desk = img(d.screens.desktop);
    const mob = img(d.screens.mobile);
    const after = img(d.screens.after);
    const devices = desk || mob ? `<div class="devices">${desk ? browserFrame(desk, `${client.businessName} on a computer`) : ""}${mob ? phoneFrame(mob) : ""}</div>` : "";
    const beforeAfter =
      desk && after
        ? `<h3 class="ptitle">Today, and after our first changes</h3><div class="beforeafter"><figure><figcaption class="ba-now">Today</figcaption>${browserFrame(desk)}</figure><figure><figcaption class="ba-after">After our work</figcaption>${browserFrame(after)}</figure></div><p class="muted small">Illustrative mockup drawn on your live homepage: green tags mark what we would change. Final design and wording are agreed with you.</p>`
        : "";
    if (devices || beforeAfter) return devices + beforeAfter;
  }
  if (key === "gbp" && d.gbp) return gbpBlock(d.gbp);
  if (key === "reputation" && d.reviews?.length) return reviewCards(d.reviews);
  if (key === "roadmap" && d.phases?.length) {
    return `<div class="phases">${d.phases
      .map((p, i) => `<div class="phase"><div class="dot">${i + 1}</div><div><div class="period">${escapeHtml(p.period)}</div><h3>${escapeHtml(p.title)}</h3><ul class="checks">${p.items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div></div>`)
      .join("")}</div>`;
  }
  if (key === "deliverables" && v.deliverables.length) {
    return `<div class="tiles two">${v.deliverables.map((x) => `<div class="tile">${icon("check", "tic")}<b>${escapeHtml(x.title)}</b><p>${escapeHtml(x.detail)}</p></div>`).join("")}</div>`;
  }
  if (key === "what_you_get" && v.services.length) {
    return `<div class="svc">${v.services.map((s) => `<span>${icon(SERVICE_ICONS[s] ?? "check", "mini")}${escapeHtml(SERVICES[s])}</span>`).join("")}</div>`;
  }
  if (key === "next_steps") {
    const b = v.branding;
    const contact = [b.consultantName, b.email, b.phone].filter(Boolean) as string[];
    return `<div class="cta"><div><p class="big">Let's grow ${escapeHtml(client.businessName)} together.</p>${contact.length ? `<p>${contact.map(escapeHtml).join(" · ")}</p>` : ""}${b.website ? `<p>${link(b.website)}</p>` : ""}</div></div>`;
  }
  if (key === "acceptance") {
    const sig = (who: string, name: string) =>
      `<div class="sig"><p class="who">${escapeHtml(who)}</p><p>${escapeHtml(name)}</p><div class="line"></div><p class="muted small">Signature</p><div class="line"></div><p class="muted small">Name and date</p></div>`;
    return `<div class="sigs">${sig("For the client", client.businessName)}${sig("For the consultant", v.branding.companyName || v.branding.consultantName || "")}</div>`;
  }
  return "";
}

function glancePage(v: RenderVersion, client: RenderClient) {
  const snap = snapshot(v);
  const gbp = ((v.sections.find((s) => s.key === "gbp" && s.included)?.data ?? {}) as SectionData).gbp;
  if (!snap && !gbp) return "";
  const maxCat = Math.max(1, ...(snap?.categories.map((c) => c[1]) ?? [1]));
  return `<section class="page glance" id="glance">
    <p class="eyebrow">At a glance</p>
    <h2 class="gtitle">${escapeHtml(client.businessName)}'s SEO snapshot</h2>
    <div class="ggrid">
      ${
        snap
          ? `<div class="gcard score">${scoreRing(snap.score, snap.tone)}<p class="verdict" style="color:${snap.tone}">${snap.verdict}</p><p class="muted small">Website SEO health from our audit — the higher, the easier it is for Google to recommend you.</p></div>
      <div class="gcard">
        <div class="kpis">${[
          [snap.issues, "Issues to fix"],
          [snap.high, "High priority"],
          [snap.opportunities, "Growth opportunities"],
        ]
          .filter(([n]) => (n as number) > 0)
          .map(([n, label]) => `<div><b>${n}</b><span>${label}</span></div>`)
          .join("")}</div>
        ${snap.categories.length ? `<div class="bars">${snap.categories.map(([c, n]) => `<div class="bar"><span>${escapeHtml(c)}</span><i><em style="width:${Math.round((n / maxCat) * 100)}%"></em></i><b>${n}</b></div>`).join("")}</div>` : ""}
      </div>`
          : ""
      }
      ${
        gbp
          ? `<div class="gcard gmini">${icon("pin", "tic")}<p class="muted small">Google Business Profile</p>${gbp.rating != null ? `<p class="rating"><b>${gbp.rating.toFixed(1)}</b>${stars(gbp.rating, 15)}</p><p class="muted small">${gbp.reviewCount ?? 0} reviews</p>` : `<p><b>${escapeHtml(gbp.name)}</b></p>`}${gbp.rankings[0] ? `<p class="small">Google Maps for “${escapeHtml(gbp.rankings[0].query)}”: <b>${gbp.rankings[0].position == null ? "not in top 20" : `#${gbp.rankings[0].position}`}</b></p>` : ""}</div>`
          : ""
      }
    </div>
    ${snap?.top.length ? `<h3 class="ptitle">Our first priorities for you</h3><div class="prio">${snap.top.map((f, i) => `<div><span>${i + 1}</span><b>${escapeHtml(f.title)}</b><p>${escapeHtml(f.solution)}</p></div>`).join("")}</div>` : ""}
  </section>`;
}

export function renderProposalHtml(v: RenderVersion, client: RenderClient) {
  const b = v.branding;
  const theme = resolvePalette(v.theme, b.brandColor);
  const sections = v.sections.filter((s) => s.included && (s.key !== "appendix" || v.includeAppendix) && (s.body.trim() || s.data));
  const coverShot = (() => {
    const screens = ((v.sections.find((s) => s.key === "audit_overview")?.data ?? {}) as SectionData).screens;
    return screens?.desktop ? (v.images?.[screens.desktop] ?? null) : null;
  })();
  const snap = snapshot(v);

  const body = sections
    .map((s, i) => {
      const cls = ["sec", `sec-${s.key}`, s.key === "appendix" || s.key === "acceptance" ? "break-before" : ""].join(" ");
      return `<section class="${cls}" id="${escapeHtml(s.key)}"><header class="sh"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="sic">${icon(SECTION_ICONS[s.key] ?? "info")}</span><h2>${escapeHtml(s.title)}</h2></header>${s.body ? sectionBody(s.key, s.body) : ""}${sectionExtras(s.key, s.data, v, client)}</section>`;
    })
    .join("");

  const toc = sections
    .filter((s) => !["acceptance", "appendix"].includes(s.key))
    .slice(0, 12)
    .map((s, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${escapeHtml(s.title)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(v.title)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
  @page :first { margin: 0; }
  :root { --primary: ${theme.primary}; --dark: ${theme.dark}; --soft: ${theme.soft}; --mid: color-mix(in srgb, var(--primary) 55%, #ffffff); --text: #1e293b; --muted: #64748b; --border: #e2e8f0; --bg: #f8fafc; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: "Segoe UI", "Helvetica Neue", Arial, "Noto Sans", "Noto Naskh Arabic", "Noto Nastaliq Urdu", sans-serif; color: var(--text); font-size: 10.5pt; line-height: 1.6; background: #fff; }
  a { color: var(--primary); text-decoration: none; word-break: break-word; }
  p { margin: 0 0 3mm; }
  .muted { color: var(--muted); } .small { font-size: 8.5pt; }
  .ic { width: 20px; height: 20px; } .mini { width: 13px; height: 13px; vertical-align: -2px; margin-right: 4px; } .tic { width: 22px; height: 22px; color: var(--primary); }

  /* Cover */
  .cover { height: 297mm; padding: 22mm 20mm 18mm; color: #fff; display: flex; flex-direction: column; position: relative; overflow: hidden; break-after: page; page-break-after: always;
    background: radial-gradient(120mm 120mm at 105% -5%, color-mix(in srgb, var(--primary) 70%, transparent), transparent 70%), radial-gradient(90mm 90mm at -10% 105%, color-mix(in srgb, var(--primary) 45%, transparent), transparent 70%), linear-gradient(160deg, var(--dark) 0%, color-mix(in srgb, var(--dark) 82%, var(--primary)) 100%); }
  .cover .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 12pt; letter-spacing: .01em; }
  .cover .brand img { max-height: 15mm; max-width: 48mm; background: #fff; border-radius: 8px; padding: 4px 6px; }
  .cover .kicker { margin-top: 12mm; display: inline-block; text-transform: uppercase; letter-spacing: .18em; font-size: 9pt; font-weight: 700; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.25); padding: 1.6mm 4.5mm; border-radius: 99px; align-self: flex-start; }
  .cover h1 { font-size: 34pt; line-height: 1.06; margin: 6mm 0 4mm; font-weight: 800; letter-spacing: -.02em; max-width: 170mm; }
  .cover .tagline { font-size: 14.5pt; line-height: 1.45; opacity: .9; max-width: 150mm; margin: 0 0 7mm; }
  .cover .client { font-size: 11.5pt; opacity: .95; } .cover .client strong { font-size: 15pt; } .cover .client a { color: #fff; opacity: .75; }
  .cover .shot { margin-top: 7mm; max-width: 128mm; transform: perspective(900px) rotateX(4deg); }
  .cover .shot .browser { box-shadow: 0 25px 60px rgba(0,0,0,.45); border-color: rgba(255,255,255,.25); }
  .cover .chips { margin-top: 7mm; display: flex; gap: 4mm; flex-wrap: wrap; }
  .cover .chips div { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 10px; padding: 3.5mm 5mm; min-width: 38mm; }
  .cover .chips b { display: block; font-size: 24pt; line-height: 1; font-weight: 800; } .cover .chips span { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; opacity: .8; }
  .cover .meta { margin-top: auto; padding-top: 8mm; display: flex; gap: 10mm; font-size: 10pt; border-top: 1px solid rgba(255,255,255,.18); }
  .cover .meta span { display: block; opacity: .6; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .1em; }
  .cover .contact { margin-top: 5mm; font-size: 8.5pt; opacity: .75; }

  /* At a glance + contents */
  .page { break-after: page; page-break-after: always; }
  .eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: 8.5pt; font-weight: 700; color: var(--primary); margin: 0 0 1mm; }
  .gtitle { font-size: 22pt; margin: 0 0 7mm; color: var(--dark); letter-spacing: -.01em; }
  .ggrid { display: grid; grid-template-columns: 58mm 1fr; gap: 5mm; }
  .gcard { border: 1px solid var(--border); border-radius: 14px; padding: 5mm; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.04); break-inside: avoid; }
  .gcard.score { text-align: center; } .gcard .verdict { font-weight: 800; font-size: 12pt; margin: 1mm 0; }
  .gmini { grid-column: 1 / -1; display: flex; align-items: center; gap: 5mm; flex-wrap: wrap; background: var(--soft); border-color: transparent; }
  .gmini p { margin: 0; } .rating { display: flex; align-items: center; gap: 2mm; } .rating b { font-size: 20pt; font-weight: 800; color: var(--dark); }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-bottom: 5mm; }
  .kpis div { background: var(--soft); border-radius: 10px; padding: 3mm 4mm; } .kpis b { display: block; font-size: 22pt; line-height: 1; font-weight: 800; color: var(--dark); } .kpis span { font-size: 8pt; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .bars .bar { display: grid; grid-template-columns: 34mm 1fr 8mm; align-items: center; gap: 3mm; margin-bottom: 2.2mm; font-size: 9pt; }
  .bars i { display: block; height: 7px; background: #eef1f6; border-radius: 99px; overflow: hidden; } .bars em { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--primary), var(--mid)); }
  .bars b { text-align: right; color: var(--dark); }
  .ptitle { margin: 8mm 0 3mm; font-size: 13pt; color: var(--dark); }
  .prio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .prio div { border-radius: 12px; padding: 4mm; background: linear-gradient(160deg, var(--soft), #fff); border: 1px solid var(--border); break-inside: avoid; }
  .prio span { display: inline-flex; width: 7mm; height: 7mm; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 800; align-items: center; justify-content: center; font-size: 10pt; }
  .prio b { display: block; margin: 2mm 0 1mm; color: var(--dark); line-height: 1.3; } .prio p { font-size: 8.8pt; color: var(--muted); margin: 0; }
  .toc { margin-top: 8mm; columns: 2; column-gap: 8mm; list-style: none; padding: 0; font-size: 9.5pt; }
  .toc li { padding: 1.4mm 0; border-bottom: 1px dashed var(--border); break-inside: avoid; } .toc span { color: var(--primary); font-weight: 700; margin-right: 3mm; }

  /* Sections */
  .sec { margin: 0 0 11mm; }
  .break-before { break-before: page; page-break-before: always; }
  .sh { display: flex; align-items: center; gap: 3mm; margin: 0 0 4.5mm; padding-bottom: 3mm; border-bottom: 2px solid var(--soft); break-after: avoid; }
  .sh .num { font-size: 9pt; font-weight: 800; color: var(--primary); letter-spacing: .05em; }
  .sh .sic { display: inline-flex; width: 9mm; height: 9mm; border-radius: 10px; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, var(--primary), var(--mid)); }
  .sh .sic .ic { width: 17px; height: 17px; }
  .sh h2 { font-size: 16.5pt; margin: 0; color: var(--dark); letter-spacing: -.01em; line-height: 1.2; }
  .lead { font-size: 12.2pt; line-height: 1.55; color: #0f172a; }
  .sec-executive_summary .lead { font-size: 13.5pt; border-left: 4px solid var(--primary); padding-left: 5mm; }
  h3 { font-size: 11.5pt; margin: 0 0 1.5mm; color: var(--dark); break-after: avoid; } h4 { margin: 0 0 1mm; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  ul.checks { list-style: none; padding: 0; margin: 0 0 4mm; } ul.checks li { position: relative; padding-left: 7mm; margin-bottom: 1.8mm; }
  ul.checks li::before { content: ""; position: absolute; left: 0; top: 1.2mm; width: 4.2mm; height: 4.2mm; border-radius: 50%; background: var(--soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23334155' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / 62% no-repeat; }
  .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; margin: 2mm 0 4mm; }
  .tile { border: 1px solid var(--border); border-radius: 12px; padding: 4mm 4.5mm; background: #fff; break-inside: avoid; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
  .tile b { display: block; margin: 1.5mm 0 1mm; color: var(--dark); line-height: 1.3; } .tile p { margin: 0; font-size: 9.2pt; color: #475569; }
  .svc { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; } .svc span { background: var(--soft); color: var(--dark); border-radius: 99px; padding: 1.4mm 3.5mm; font-size: 8.8pt; font-weight: 600; }
  ol.steps { list-style: none; padding: 0; margin: 2mm 0 4mm; display: grid; grid-template-columns: repeat(4, 1fr); gap: 3.5mm; counter-reset: s; }
  ol.steps li { border-radius: 12px; padding: 4mm; background: linear-gradient(170deg, var(--soft), #fff 70%); border: 1px solid var(--border); break-inside: avoid; }
  ol.steps .n { display: inline-flex; width: 8mm; height: 8mm; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 800; align-items: center; justify-content: center; }
  ol.steps b { display: block; margin: 2.5mm 0 1mm; color: var(--dark); } ol.steps p { margin: 0; font-size: 9pt; color: #475569; }
  ol.timeline { list-style: none; padding: 0 0 0 6mm; margin: 2mm 0 5mm; border-left: 3px solid var(--soft); }
  ol.timeline li { position: relative; margin-bottom: 3.5mm; } ol.timeline li::before { content: ""; position: absolute; left: -8.6mm; top: 1.2mm; width: 4mm; height: 4mm; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 3px #fff; }
  ol.timeline b { color: var(--dark); } ol.timeline p { margin: .5mm 0 0; color: #475569; }

  /* Findings */
  .finding { border: 1px solid var(--border); border-radius: 14px; padding: 4.5mm 5mm; margin: 0 0 5mm; break-inside: avoid; position: relative; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .finding::before { content: ""; position: absolute; left: 0; top: 4mm; bottom: 4mm; width: 4px; border-radius: 0 4px 4px 0; background: #94a3b8; }
  .finding.high::before { background: #dc2626; } .finding.medium::before { background: #d97706; }
  .finding header { display: flex; flex-wrap: wrap; align-items: center; gap: 2mm; margin-bottom: 2mm; }
  .finding .when { margin-left: auto; font-size: 8.5pt; color: var(--muted); }
  .finding h3 { font-size: 12.5pt; }
  .fgrid { display: grid; gap: 3mm; } .fgrid p { margin: 0; } .fgrid .fix { background: var(--soft); border-radius: 10px; padding: 3mm 4mm; }
  .fgrid .fix h4 { color: var(--primary); }
  .with-shot { display: grid; grid-template-columns: 1fr 72mm; gap: 5mm; align-items: start; }
  .where { font-size: 8.5pt; margin-top: 1mm !important; }
  .evidence { font-size: 8.3pt; color: var(--muted); margin: 3mm 0 0; padding-top: 2mm; border-top: 1px dashed var(--border); word-break: break-word; }
  .finding.compact { padding: 3mm 4mm; font-size: 9pt; } .finding.compact h3 { font-size: 10.5pt; } .finding.compact .fgrid { grid-template-columns: 1fr 1fr; } .finding.compact .fgrid .fix { grid-column: 1 / -1; }
  .pill { font-size: 7.3pt; font-weight: 700; padding: .7mm 2.4mm; border-radius: 99px; text-transform: uppercase; letter-spacing: .06em; }
  .pill.high { background: #fee2e2; color: #b91c1c; } .pill.medium { background: #fef3c7; color: #b45309; } .pill.low { background: #f1f5f9; color: #475569; }
  .tag { font-size: 7.5pt; padding: .7mm 2.4mm; border-radius: 99px; background: var(--soft); color: var(--dark); font-weight: 600; }

  /* Device frames */
  .browser { margin: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 8px 22px rgba(15,23,42,.12); }
  .browser .bar { height: 6mm; background: #f1f5f9; display: flex; align-items: center; gap: 1.4mm; padding: 0 3mm; border-bottom: 1px solid var(--border); }
  .browser .bar i { width: 2.2mm; height: 2.2mm; border-radius: 50%; background: #cbd5e1; } .browser .bar i:first-child { background: #f87171; } .browser .bar i:nth-child(2) { background: #fbbf24; } .browser .bar i:nth-child(3) { background: #34d399; }
  .browser img { display: block; width: 100%; } .browser figcaption { font-size: 7.5pt; color: var(--muted); padding: 1.5mm 3mm; background: #f8fafc; border-top: 1px solid var(--border); }
  .devices { display: grid; grid-template-columns: 1fr 48mm; gap: 7mm; align-items: end; margin: 3mm 0 2mm; }
  .beforeafter { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 3mm 0 2mm; break-inside: avoid; }
  .beforeafter figure { margin: 0; }
  .beforeafter figcaption { display: inline-block; margin-bottom: 2mm; padding: 1mm 3mm; border-radius: 99px; font-size: 9pt; font-weight: 700; }
  .ba-now { background: #f1f5f9; color: #475569; } .ba-after { background: #dcfce7; color: #15803d; }
  .phone { margin: 0; border: 3mm solid #0f172a; border-radius: 9mm; overflow: hidden; background: #0f172a; position: relative; box-shadow: 0 12px 28px rgba(15,23,42,.25); }
  .phone .notch { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 16mm; height: 3.5mm; background: #0f172a; border-radius: 0 0 3mm 3mm; z-index: 1; }
  .phone img { display: block; width: 100%; border-radius: 6mm; }

  /* Tables */
  table.data { width: 100%; border-collapse: separate; border-spacing: 0; margin: 2mm 0 3mm; font-size: 9.6pt; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  table.data th { text-align: left; background: var(--soft); color: var(--dark); font-size: 8.5pt; padding: 2.6mm 3.5mm; text-transform: uppercase; letter-spacing: .05em; }
  table.data td { padding: 2.6mm 3.5mm; border-top: 1px solid var(--border); vertical-align: top; } table.data tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .intent { font-size: 8.5pt; background: #f1f5f9; border-radius: 99px; padding: .5mm 2.2mm; white-space: nowrap; }
  .rank { font-weight: 700; padding: .6mm 2.6mm; border-radius: 99px; font-size: 9pt; } .rank.good { background: #dcfce7; color: #15803d; } .rank.mid { background: #fef3c7; color: #b45309; } .rank.bad { background: #fee2e2; color: #b91c1c; }

  /* Google Business Profile + reviews */
  .gbp { display: grid; grid-template-columns: 62mm 1fr; gap: 5mm; margin: 3mm 0; align-items: start; }
  .gbp-card { border-radius: 14px; padding: 5mm; color: #fff; background: linear-gradient(150deg, var(--primary), var(--dark)); break-inside: avoid; }
  .gbp-card .cat { text-transform: uppercase; font-size: 7.5pt; letter-spacing: .12em; opacity: .75; margin: 0; } .gbp-card .name { font-size: 13pt; font-weight: 800; margin: 1mm 0 3mm; line-height: 1.25; }
  .gbp-card .rating b { color: #fff; } .gbp-card .count { opacity: .8; font-size: 9pt; }
  .gbp-card .facts { display: flex; gap: 6mm; margin-top: 4mm; } .gbp-card .facts span { font-weight: 800; font-size: 13pt; } .gbp-card small { display: block; font-weight: 400; font-size: 7.5pt; opacity: .75; text-transform: uppercase; letter-spacing: .06em; }
  ul.issues { list-style: none; padding: 0; margin: 2mm 0 0; } ul.issues li { border: 1px solid var(--border); border-left: 4px solid #d97706; border-radius: 10px; padding: 2.5mm 3.5mm; margin-bottom: 2.2mm; break-inside: avoid; }
  ul.issues li.high { border-left-color: #dc2626; } ul.issues b { display: block; color: var(--dark); } ul.issues span { font-size: 9pt; color: #475569; }
  .reviews { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; margin: 3mm 0 5mm; }
  .reviews blockquote { margin: 0; border-radius: 12px; padding: 4mm; background: #fff7f7; border: 1px solid #fecaca; break-inside: avoid; }
  .reviews p { margin: 2mm 0; font-style: italic; color: #334155; font-size: 9.5pt; } .reviews cite { font-size: 8pt; color: var(--muted); font-style: normal; }
  .stars svg { vertical-align: -2px; margin-right: 1px; }

  /* Roadmap */
  .phases { display: grid; gap: 4mm; } .phase { display: grid; grid-template-columns: 10mm 1fr; gap: 4mm; border: 1px solid var(--border); border-radius: 12px; padding: 4mm; break-inside: avoid; background: #fff; }
  .phase .dot { width: 10mm; height: 10mm; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--mid)); color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; }
  .phase .period { color: var(--primary); font-weight: 800; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; }

  /* CTA and signatures */
  .cta { margin-top: 4mm; border-radius: 16px; padding: 7mm; color: #fff; background: linear-gradient(135deg, var(--dark), color-mix(in srgb, var(--dark) 55%, var(--primary))); display: flex; gap: 6mm; align-items: center; justify-content: space-between; break-inside: avoid; }
  .cta p { margin: 0 0 1.5mm; opacity: .9; } .cta .big { font-size: 17pt; font-weight: 800; opacity: 1; line-height: 1.2; margin-bottom: 3mm; } .cta a { color: #fff; text-decoration: underline; }
  .cta .qr { text-align: center; font-size: 8pt; } .cta .qr img { width: 30mm; height: 30mm; background: #fff; border-radius: 8px; padding: 2mm; display: block; margin-bottom: 1.5mm; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 8mm; } .sig .who { font-weight: 700; color: var(--dark); } .sig .line { border-bottom: 1px solid var(--text); height: 14mm; }
  .notes { background: var(--soft); border-radius: 12px; padding: 4mm 5mm; margin-bottom: 8mm; }

  @media screen {
    body { background: #e8ecf3; }
    .cover, main, .glance { max-width: 210mm; margin: 0 auto; }
    .cover { height: auto; min-height: 297mm; }
    .glance, main { background: #fff; padding: 16mm 15mm; margin-bottom: 8mm; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
  }
  @media screen and (max-width: 700px) {
    .ggrid, .with-shot, .gbp, .devices, .beforeafter, .tiles, .prio, ol.steps, .reviews, .finding.compact .fgrid { grid-template-columns: 1fr; }
    .cover { padding: 14mm 8mm; } .cover h1 { font-size: 26pt; } .glance, main { padding: 10mm 6mm; }
  }
</style></head>
<body>
<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="half"><stop offset="50%" stop-color="#f59e0b"/><stop offset="50%" stop-color="#e2e8f0"/></linearGradient></defs></svg>
<div class="cover" id="cover">
  <div class="brand">${b.logoDataUri ? `<img src="${escapeHtml(b.logoDataUri)}" alt="">` : ""}<span>${escapeHtml(b.companyName || b.consultantName || "")}</span></div>
  <div class="kicker">SEO growth proposal</div>
  <h1>${escapeHtml(v.title)}</h1>
  <p class="tagline">A clear, evidence-based plan to help ${escapeHtml(client.businessName)} get found on Google and turn more searches into customers.</p>
  <div class="client">Prepared for <strong>${escapeHtml(client.businessName)}</strong>${client.contactName ? ` · ${escapeHtml(client.contactName)}` : ""}<br>${link(client.websiteUrl)}</div>
  ${coverShot ? `<div class="shot">${browserFrame(coverShot)}</div>` : ""}
  ${snap ? `<div class="chips">${[
    { n: snap.issues, label: "Issues to fix" },
    { n: snap.high, label: "High priority" },
    { n: snap.opportunities, label: "Opportunities" },
  ]
    .filter((x) => x.n > 0)
    .map((x) => `<div><b>${x.n}</b><span>${x.label}</span></div>`)
    .join("")}</div>` : ""}
  <div class="meta">
    <div><span>Date</span>${fmtDate(v.proposalDate)}</div>
    <div><span>Version</span>v${v.version}</div>
    ${v.validUntil ? `<div><span>Valid until</span>${fmtDate(v.validUntil)}</div>` : ""}
  </div>
  ${[b.consultantName, b.email, b.phone, b.website].some(Boolean) ? `<div class="contact">${[b.consultantName, b.email, b.phone, b.website].filter(Boolean).map((x) => escapeHtml(x!)).join(" · ")}</div>` : ""}
</div>
${glancePage(v, client).replace("</section>", toc ? `<h3 class="ptitle">Inside this proposal</h3><ol class="toc">${toc}</ol></section>` : "</section>")}
<main>
${v.clientNotes ? `<div class="notes">${renderText(v.clientNotes)}</div>` : ""}
${body}
</main>
</body></html>`;
}

/** Footer used by the PDF renderer (page numbers + brand). */
export function pdfFooterTemplate(v: Pick<RenderVersion, "title" | "branding" | "version">) {
  const left = escapeHtml([v.branding.companyName || v.branding.consultantName, `${v.title} · v${v.version}`].filter(Boolean).join(" · "));
  return `<div style="width:100%;font-size:7.5pt;color:#6b7686;padding:0 15mm;display:flex;justify-content:space-between;font-family:'Segoe UI',Arial,sans-serif;"><span>${left}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}
