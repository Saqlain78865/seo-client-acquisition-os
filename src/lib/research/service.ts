import "server-only";
import { db } from "../db";
import { logActivity } from "../activity";
import { crawlSite } from "../crawler/crawl";
import { isOtherLanguage } from "../crawler/classify";
import { assertUrlShape } from "../crawler/network-guard";
import { FetchError } from "../crawler/safe-fetch";
import { normalizeDomain, normalizeWebsiteUrl } from "../url";
import { runnerOptions } from "../audit/runner";
import { titleBrand } from "../audit/business";
import { CsvImportError, IMPORT_SOURCES, decodeCsv, parseImport, type ImportKind, type ImportSource } from "./csv";
import { classifyIntent, clusterKeywords, FUNNEL, generateSeeds, keywordPriority, mapClusterToPage, recommendedPageType, type Intent } from "./keywords";
import { performanceFinding, runPageSpeed, type Strategy } from "./pagespeed";
import { getApiKey } from "../integrations";
import { checkDomain } from "./domain";
import { AiError, getAiProvider, type AiProvider } from "../ai/provider";
import { suggestKeywords } from "./ai-keywords";
import { GbpError, fetchGbp, parsePastedReviews, type GbpData } from "./gbp";

export class ResearchError extends Error {}

async function ownedProspect(workspaceId: string, prospectId: string) {
  const p = await db.prospect.findFirst({ where: { id: prospectId, workspaceId } });
  if (!p) throw new ResearchError("Prospect not found.");
  return p;
}

// ───────────────────────────── CSV import ─────────────────────────────

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function importCsv(
  workspaceId: string,
  userId: string,
  prospectId: string,
  file: { name: string; buffer: Buffer },
  opts: { kind?: ImportKind; source?: ImportSource; periodLabel?: string } = {},
) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  if (file.buffer.length > MAX_IMPORT_BYTES) throw new ResearchError("The file is larger than 8 MB.");
  if (!/\.(csv|tsv|txt)$/i.test(file.name)) throw new ResearchError("Upload a .csv or .tsv export.");
  let parsed;
  try {
    parsed = parseImport(decodeCsv(file.buffer), opts);
  } catch (e) {
    if (e instanceof CsvImportError) throw new ResearchError(e.message);
    throw new ResearchError("The file could not be read as CSV.");
  }
  if (parsed.rows.length === 0) throw new ResearchError("No usable rows were found in the file.");

  const isEstimate = parsed.source !== "GOOGLE_SEARCH_CONSOLE";
  const imp = await db.dataImport.create({
    data: {
      workspaceId,
      prospectId,
      kind: parsed.kind,
      source: parsed.source,
      fileName: file.name.slice(0, 200),
      rowCount: parsed.rows.length,
      skippedRows: parsed.skipped,
      columnMap: parsed.columnMap,
      periodLabel: opts.periodLabel?.slice(0, 80) || null,
      isEstimate,
      importedById: userId,
    },
  });
  const sourceLabel = `${IMPORT_SOURCES[parsed.source]} export (${file.name})`;
  const now = new Date();

  if (parsed.kind === "KEYWORDS") {
    const existing = new Map((await db.keyword.findMany({ where: { prospectId } })).map((k) => [k.keyword, k]));
    await db.$transaction(async (tx) => {
      for (const r of parsed.rows) {
        const data = {
          searchVolume: r.volume != null ? Math.round(r.volume) : null,
          volumeIsEstimate: isEstimate,
          difficulty: r.difficulty,
          cpc: r.cpc,
          currentRank: r.position != null ? Math.round(r.position) : null,
          targetUrl: r.url,
          country: r.country,
          intent: r.intent ? classifyIntent(r.keyword, [], r.intent) : undefined,
          dataSource: sourceLabel,
          retrievedAt: now,
          importId: imp.id,
          isSeed: false,
          confidence: isEstimate ? "MEDIUM" : "HIGH",
        };
        const prev = existing.get(r.keyword);
        if (prev) await tx.keyword.update({ where: { id: prev.id }, data });
        else await tx.keyword.create({ data: { ...data, workspaceId, prospectId, keyword: r.keyword } });
      }
    });
  } else if (parsed.kind === "BACKLINKS") {
    await db.referringDomain.createMany({
      data: parsed.rows.map((r) => ({ importId: imp.id, prospectId, domain: r.domain, authority: r.authority, authorityMetric: parsed.authorityMetric, backlinks: r.backlinks != null ? Math.round(r.backlinks) : null, dofollow: r.dofollow, firstSeen: r.firstSeen })),
    });
  } else {
    await db.searchConsoleRow.createMany({
      data: parsed.rows.map((r) => ({ importId: imp.id, prospectId, dimension: parsed.kind === "GSC_PAGES" ? "PAGE" : "QUERY", value: r.value, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position })),
    });
  }
  await logActivity({ workspaceId, prospectId, userId, type: "research.imported", message: `${IMPORT_SOURCES[parsed.source]} data imported: ${parsed.rows.length} rows (${file.name})`, metadata: { importId: imp.id, kind: parsed.kind } });
  return { importId: imp.id, kind: parsed.kind, source: parsed.source, rows: parsed.rows.length, skipped: parsed.skipped, prospectName: prospect.businessName };
}

export async function deleteImport(workspaceId: string, importId: string) {
  const imp = await db.dataImport.findFirst({ where: { id: importId, workspaceId } });
  if (!imp) throw new ResearchError("Import not found.");
  // Keywords created from this import keep their text but lose the imported metrics.
  await db.keyword.updateMany({ where: { importId }, data: { searchVolume: null, difficulty: null, cpc: null, currentRank: null, importId: null, dataSource: "Metrics removed with their import" } });
  await db.dataImport.delete({ where: { id: importId } });
  return imp.prospectId;
}

// ───────────────────────────── Keywords ─────────────────────────────

// Pages that are never about one service.
const NON_OFFER_TYPES = new Set(["HOMEPAGE", "CONTACT", "ABOUT", "FAQ", "BLOG_ARTICLE", "CATEGORY", "BOOKING"]);

/** Main headings of the site's own-language offer pages — works for audits made before page types improved. */
function offerPageHeadings(pages: { url: string; finalUrl: string | null; title: string | null; h1: unknown; pageType: string | null }[], homeUrl: string | null) {
  return pages
    .filter((p) => !NON_OFFER_TYPES.has(p.pageType ?? "OTHER") && !new URL(p.finalUrl ?? p.url).search && !isOtherLanguage(p.finalUrl ?? p.url, homeUrl))
    .map((p) => ((p.h1 as string[] | null) ?? [])[0] || p.title)
    .filter((h): h is string => !!h);
}

async function latestAudit(prospectId: string) {
  return db.websiteAudit.findFirst({
    where: { prospectId, status: { in: ["COMPLETED", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    include: { pages: { where: { httpStatus: { lt: 400 } }, select: { url: true, finalUrl: true, title: true, h1: true, pageType: true } } },
  });
}

const SEED_SOURCE = "Idea generated from services and locations (no metrics)";

/** Seed keyword ideas from the prospect's services and locations. They carry no metrics. Re-running replaces the earlier ones. */
export async function generateSeedKeywords(workspaceId: string, prospectId: string) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const audit = await latestAudit(prospectId);
  const ctx = (audit?.context ?? {}) as Record<string, string | undefined>;
  const business = (audit?.analysis as { business?: { services: { value: string; sources?: string[] }[]; locations: { value: string; sources?: string[] }[] } } | null)?.business;
  const homeUrl = audit?.pages.find((p) => p.pageType === "HOMEPAGE")?.finalUrl ?? null;
  const sameLanguage = (v: { sources?: string[] }) => !v.sources?.[0] || !isOtherLanguage(v.sources[0], homeUrl);
  const services = [ctx.primaryService, ...(ctx.secondaryServices ?? "").split(","), ...(prospect.primaryServices ?? "").split(","), ...(business?.services.filter(sameLanguage).map((s) => s.value) ?? []), ...offerPageHeadings(audit?.pages ?? [], homeUrl)].filter((s): s is string => !!s?.trim());
  const locations = [ctx.targetCity, prospect.city, ...(business?.locations.filter(sameLanguage).map((l) => l.value) ?? []).filter((l) => l.length < 60)].filter((s): s is string => !!s?.trim());
  if (!services.length) throw new ResearchError("Add the prospect's services (on the prospect or audit) to generate keyword ideas.");
  const ideas = generateSeeds(services, locations);
  if (!ideas.length) throw new ResearchError("No clear service names were found. Add the prospect's main services on the prospect page, then try again.");
  await db.keyword.deleteMany({ where: { prospectId, workspaceId, dataSource: SEED_SOURCE, inProposal: false, importId: null } });
  const existing = new Set((await db.keyword.findMany({ where: { prospectId }, select: { keyword: true } })).map((k) => k.keyword));
  const fresh = ideas.filter((i) => !existing.has(i));
  if (fresh.length) {
    await db.keyword.createMany({
      data: fresh.map((keyword) => ({ workspaceId, prospectId, keyword, isSeed: true, dataSource: SEED_SOURCE, confidence: "LOW", country: prospect.country, region: ctx.targetCity ?? prospect.city, status: "IDEA" })),
    });
  }
  await analyseKeywords(workspaceId, prospectId);
  return { created: fresh.length, total: ideas.length };
}

/**
 * Keyword ideas written by Gemini from the prospect's services, locations, audited pages and Search
 * Console queries. Saved as ideas without metrics; demand must still come from real data.
 */
export async function generateAiKeywordIdeas(workspaceId: string, prospectId: string, providerOverride?: AiProvider) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const provider = providerOverride ?? getAiProvider(await getApiKey(workspaceId, "GEMINI"));
  if (!provider) throw new ResearchError("Add a free Gemini API key on the Integrations page to get AI keyword ideas.");
  const [audit, existing, gsc] = await Promise.all([
    latestAudit(prospectId),
    db.keyword.findMany({ where: { prospectId }, select: { keyword: true } }),
    db.searchConsoleRow.findMany({ where: { prospectId, dimension: "QUERY" }, orderBy: { impressions: "desc" }, take: 20, select: { value: true } }),
  ]);
  const ctx = (audit?.context ?? {}) as Record<string, string | undefined>;
  const business = (audit?.analysis as { business?: { services: { value: string }[]; locations: { value: string }[] } } | null)?.business;
  const services = [...new Set([ctx.primaryService, ...(ctx.secondaryServices ?? "").split(","), ...(prospect.primaryServices ?? "").split(","), ...(business?.services.map((s) => s.value) ?? [])].map((s) => s?.trim()).filter((s): s is string => !!s))];
  const locations = [...new Set([ctx.targetCity, prospect.city, ...(business?.locations.map((l) => l.value) ?? []).filter((l) => l.length < 40)].map((s) => s?.trim()).filter((s): s is string => !!s))];
  const pageTitles = (audit?.pages ?? []).map((p) => p.title).filter((t): t is string => !!t);
  if (!services.length && !pageTitles.length) throw new ResearchError("Run a website audit or add the prospect's services first, so the AI knows what the business offers.");

  let ideas;
  try {
    ideas = await suggestKeywords(provider, {
      businessName: prospect.businessName,
      domain: prospect.domain,
      services,
      locations,
      country: prospect.country ?? ctx.targetCountry ?? null,
      language: ctx.preferredLanguage ?? null,
      pageTitles,
      existing: existing.map((k) => k.keyword),
      searchConsoleQueries: gsc.map((r) => r.value),
    });
  } catch (e) {
    if (e instanceof AiError) throw new ResearchError(e.message);
    throw e;
  }
  if (ideas.length) {
    await db.keyword.createMany({
      data: ideas.map((i) => ({
        workspaceId,
        prospectId,
        keyword: i.keyword,
        intent: i.intent,
        note: i.reason || null,
        isSeed: true,
        dataSource: `AI idea (${provider.name}) — no search data`,
        confidence: "LOW",
        country: prospect.country,
        region: ctx.targetCity ?? prospect.city,
        status: "IDEA",
      })),
    });
  }
  await analyseKeywords(workspaceId, prospectId);
  return { created: ideas.length, model: provider.model };
}

/** Chooses (or un-chooses) one keyword for the proposal's keyword section. */
export async function setKeywordInProposal(workspaceId: string, prospectId: string, keywordId: string, on: boolean) {
  await ownedProspect(workspaceId, prospectId);
  const { count } = await db.keyword.updateMany({ where: { id: keywordId, prospectId, workspaceId }, data: { inProposal: on } });
  if (!count) throw new ResearchError("Keyword not found.");
  return db.keyword.count({ where: { prospectId, inProposal: true } });
}

/** Replaces the choice with the top `n` non-brand keywords by priority; n = 0 clears it. */
export async function chooseTopKeywords(workspaceId: string, prospectId: string, n: number) {
  await ownedProspect(workspaceId, prospectId);
  await db.keyword.updateMany({ where: { prospectId, workspaceId }, data: { inProposal: false } });
  if (n <= 0) return 0;
  const top = await db.keyword.findMany({ where: { prospectId, workspaceId, NOT: { intent: "NAVIGATIONAL" } }, orderBy: [{ priority: "desc" }, { keyword: "asc" }], take: Math.min(n, 20), select: { id: true } });
  await db.keyword.updateMany({ where: { id: { in: top.map((k) => k.id) } }, data: { inProposal: true } });
  return top.length;
}

export async function addManualKeywords(workspaceId: string, prospectId: string, lines: string[]) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const existing = new Set((await db.keyword.findMany({ where: { prospectId }, select: { keyword: true } })).map((k) => k.keyword));
  const fresh = [...new Set(lines.map((l) => l.trim().toLowerCase().slice(0, 300)).filter(Boolean))].filter((k) => !existing.has(k)).slice(0, 500);
  if (fresh.length) {
    await db.keyword.createMany({ data: fresh.map((keyword) => ({ workspaceId, prospectId, keyword, dataSource: "Entered manually (no metrics)", confidence: "LOW", country: prospect.country })) });
  }
  await analyseKeywords(workspaceId, prospectId);
  return fresh.length;
}

/**
 * Classifies intent, clusters, maps clusters to existing pages from the latest audit, flags gaps and
 * overlapping pages, and scores priority. Idempotent: clusters are rebuilt each time.
 */
export async function analyseKeywords(workspaceId: string, prospectId: string) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const [keywords, audit, gsc] = await Promise.all([
    db.keyword.findMany({ where: { prospectId } }),
    latestAudit(prospectId),
    db.searchConsoleRow.findMany({ where: { prospectId, dimension: "QUERY" } }),
  ]);
  const brand = [prospect.businessName.toLowerCase(), prospect.domain.split(".")[0]].filter((b) => b.length > 3);
  const ctx = (audit?.context ?? {}) as Record<string, string | undefined>;
  const locations = [ctx.targetCity, prospect.city].filter((x): x is string => !!x);
  const homeUrl = audit?.pages.find((p) => p.pageType === "HOMEPAGE")?.finalUrl ?? null;
  const seenPaths = new Set<string>();
  const pages = (audit?.pages ?? [])
    .map((p) => ({ url: p.finalUrl ?? p.url, title: p.title, h1: ((p.h1 as string[] | null) ?? [])[0] ?? null, pageType: p.pageType }))
    .filter((p) => {
      const u = new URL(p.url);
      const key = u.origin + u.pathname;
      if (seenPaths.has(key) || isOtherLanguage(p.url, homeUrl)) return false;
      seenPaths.add(key);
      return true;
    });
  const gscPos = new Map(gsc.map((r) => [r.value.toLowerCase(), r]));

  const clusters = clusterKeywords(keywords.map((k) => ({ id: k.id, keyword: k.keyword, volume: k.searchVolume, difficulty: k.difficulty })));
  const byId = new Map(keywords.map((k) => [k.id, k]));

  await db.$transaction(async (tx) => {
    await tx.keyword.updateMany({ where: { prospectId }, data: { clusterId: null } });
    await tx.keywordCluster.deleteMany({ where: { prospectId } });
    for (const c of clusters) {
      const members = c.keywordIds.map((id) => byId.get(id)!);
      const head = members[0];
      const intent = classifyIntent(head.keyword, brand, head.intent);
      const mapping = pages.length ? mapClusterToPage(c.tokens, pages) : { url: null, score: 0, competing: [] as string[] };
      const cluster = await tx.keywordCluster.create({
        data: { workspaceId, prospectId, name: c.name, intent, targetUrl: mapping.url },
      });
      for (const k of members) {
        const kIntent: Intent = classifyIntent(k.keyword, brand, k.intent);
        const measured = gscPos.get(k.keyword);
        const position = measured?.position ?? k.currentRank;
        const { score } = keywordPriority({ intent: kIntent, volume: k.searchVolume, difficulty: k.difficulty, position: position ?? null, hasPage: !!mapping.url });
        await tx.keyword.update({
          where: { id: k.id },
          data: {
            clusterId: cluster.id,
            intent: kIntent,
            funnelStage: FUNNEL[kIntent],
            targetUrl: k.targetUrl && k.importId ? k.targetUrl : mapping.url,
            recommendedPageType: mapping.url ? null : recommendedPageType(kIntent, k.keyword, locations),
            priority: score,
            status: mapping.competing.length ? "OVERLAP" : mapping.url ? "MAPPED" : pages.length ? "GAP" : k.isSeed ? "IDEA" : "NEW",
          },
        });
      }
    }
  });
  return { clusters: clusters.length, keywords: keywords.length, mappedAgainstPages: pages.length };
}

// ───────────────────────────── Competitors ─────────────────────────────

export async function addCompetitor(workspaceId: string, prospectId: string, input: { domain: string; businessName?: string; notes?: string }) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  let domain: string;
  try {
    // Host without "www."; a non-standard port is kept so the site can be reached again.
    const u = assertUrlShape(normalizeWebsiteUrl(input.domain), { allowPrivateNetworks: runnerOptions.allowPrivateNetworks });
    domain = normalizeDomain(input.domain) + (u.port ? `:${u.port}` : "");
  } catch {
    throw new ResearchError("Enter a valid public domain, e.g. competitor.com");
  }
  if (domain === prospect.domain) throw new ResearchError("That is the prospect's own domain.");
  const dup = await db.competitor.findFirst({ where: { prospectId, domain } });
  if (dup) throw new ResearchError("This competitor is already added.");
  return db.competitor.create({ data: { workspaceId, prospectId, domain, businessName: input.businessName?.trim() || null, notes: input.notes?.trim() || null, source: "MANUAL" } });
}

/** Crawls a competitor's public pages (small limit) and records what is directly observable. */
export async function observeCompetitor(workspaceId: string, competitorId: string, pageLimit = 20) {
  const c = await db.competitor.findFirst({ where: { id: competitorId, workspaceId } });
  if (!c) throw new ResearchError("Competitor not found.");
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId } });
  const opts = { pageLimit, delayMs: Math.max(settings?.crawlDelayMs ?? 800, 250), maxRenders: 1, focus: "offers" as const, allowPrivateNetworks: runnerOptions.allowPrivateNetworks };
  let result;
  try {
    result = await crawlSite(`https://${c.domain}`, opts);
  } catch (e) {
    // Some sites still only serve plain HTTP.
    if (!(e instanceof FetchError)) throw e;
    try {
      result = await crawlSite(`http://${c.domain}`, opts);
    } catch (e2) {
      throw new ResearchError(`The competitor site could not be reached: ${(e2 as Error).message}`);
    }
  }
  const ok = result.pages.filter((p) => p.page);
  const typeCount = ok.reduce<Record<string, number>>((a, p) => ((a[p.pageType ?? "OTHER"] = (a[p.pageType ?? "OTHER"] ?? 0) + 1), a), {});
  const service = ok.filter((p) => p.pageType === "SERVICE" || p.pageType === "PRODUCT");
  const data = {
    homepageUrl: result.homepageUrl,
    pagesAnalysed: ok.length,
    limitReached: result.limitReached,
    pageTypes: typeCount,
    servicePages: service.slice(0, 15).map((p) => ({ url: p.finalUrl, title: p.page!.title, words: p.page!.wordCount })),
    locationPages: ok.filter((p) => p.pageType === "LOCATION").slice(0, 15).map((p) => ({ url: p.finalUrl, title: p.page!.title })),
    avgServicePageWords: service.length ? Math.round(service.reduce((a, p) => a + p.page!.wordCount, 0) / service.length) : null,
    schemaTypes: [...new Set(ok.flatMap((p) => p.page!.structuredData.types))].slice(0, 20),
    hasBlog: ok.some((p) => p.pageType === "BLOG_ARTICLE"),
    sitemapUrlCount: result.sitemaps.urls.length,
    homepageTitle: ok[0]?.page?.title ?? null,
  };
  await db.competitorObservation.create({ data: { competitorId: c.id, kind: "CRAWL_SUMMARY", url: result.homepageUrl, data, isEstimate: false, dataSource: `Public website crawl (${ok.length} pages)` } });
  if (!c.businessName) {
    // The site's declared name first; otherwise the end of the homepage title, but only when it
    // matches the domain — a tagline like "from authentic to premium" is not a business name.
    const fromTitle = titleBrand(data.homepageTitle);
    const domainWords = c.domain.toLowerCase().split(/[.\-]/);
    const matchesDomain = !!fromTitle && fromTitle.toLowerCase().split(/\s+/).some((w) => w.length > 3 && domainWords.some((d) => d.includes(w)));
    const brand = ok[0]?.page?.ogSiteName || (matchesDomain ? fromTitle : null);
    if (brand && brand.length < 60) await db.competitor.update({ where: { id: c.id }, data: { businessName: brand } });
  }
  return data;
}

// ───────────────────────────── PageSpeed ─────────────────────────────

/** Runs PageSpeed Insights, stores the measurement and, when warranted, a finding on the latest audit. */
export async function runPerformanceTest(workspaceId: string, userId: string, prospectId: string, strategy: Strategy, fetchImpl?: typeof fetch) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const audit = await latestAudit(prospectId);
  const url = audit?.pages.find((p) => p.pageType === "HOMEPAGE")?.finalUrl ?? prospect.websiteUrl;
  try {
    const r = await runPageSpeed(url, strategy, fetchImpl, await getApiKey(workspaceId, "PAGESPEED"));
    const test = await db.performanceTest.create({
      data: { workspaceId, prospectId, auditId: audit?.id, url, strategy, performanceScore: r.lab.performanceScore, lab: r.lab, field: r.field ?? undefined, fieldScope: r.fieldScope },
    });
    const finding = performanceFinding(r);
    if (audit) {
      const device = strategy === "MOBILE" ? "mobile" : "desktop";
      await db.auditFinding.deleteMany({ where: { auditId: audit.id, ruleId: { in: [`perf.field-cwv-${device}`, `perf.lab-${device}`] } } });
      if (finding) {
        await db.auditFinding.create({
          data: {
            auditId: audit.id,
            ruleId: finding.ruleId,
            category: finding.category,
            title: finding.title,
            severity: finding.severity,
            evidenceStatus: finding.evidenceStatus,
            affectedUrls: [url],
            observedFacts: finding.observedFacts,
            businessImpact: finding.businessImpact,
            recommendation: finding.recommendation,
            verificationMethod: finding.verificationMethod,
            confidence: finding.confidence,
            priority: finding.severity === "HIGH" ? 78 : finding.severity === "MEDIUM" ? 55 : 25,
            requiresHumanReview: finding.evidenceStatus !== "CONFIRMED",
            includeInProposal: finding.evidenceStatus === "CONFIRMED",
            evidence: { create: { auditId: audit.id, kind: "MEASUREMENT", url, measurement: finding.measurement, method: `PageSpeed Insights API (${strategy.toLowerCase()})`, collectedAt: r.fetchedAt } },
          },
        });
      }
    }
    await logActivity({ workspaceId, prospectId, userId, type: "research.pagespeed", message: `PageSpeed (${strategy.toLowerCase()}) measured: ${r.lab.performanceScore ?? "—"}/100 lab score${r.field ? `, real-user data: ${r.field.overall?.toLowerCase() ?? "available"}` : ", no real-user data"}` });
    return { test, finding };
  } catch (e) {
    await db.performanceTest.create({ data: { workspaceId, prospectId, auditId: audit?.id, url, strategy, error: (e as Error).message.slice(0, 500) } });
    throw new ResearchError((e as Error).message);
  }
}

// ───────────────────────────── Domain overview ─────────────────────────────

/** Runs the free domain overview for the prospect (competitorId null) or one of its competitors and stores it. */
export async function runDomainCheck(workspaceId: string, userId: string, prospectId: string, competitorId: string | null = null, fetchImpl?: typeof fetch) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const competitor = competitorId ? await db.competitor.findFirst({ where: { id: competitorId, prospectId, workspaceId } }) : null;
  if (competitorId && !competitor) throw new ResearchError("Competitor not found.");
  const domain = competitor?.domain ?? prospect.domain;
  const data = await checkDomain(domain, { guard: { allowPrivateNetworks: runnerOptions.allowPrivateNetworks }, fetchImpl });
  const check = await db.domainCheck.create({ data: { workspaceId, prospectId, competitorId, domain: data.domain, data: data as object } });
  await logActivity({ workspaceId, prospectId, userId, type: "research.domain_checked", message: `Domain overview checked for ${data.domain}` });
  return { check, overview: data };
}

// ───────────────────────────── Google Business Profile ─────────────────────────────

/** Searches used to check Google Maps positions: the main services in the target city. */
export async function defaultGbpQueries(workspaceId: string, prospectId: string) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const audit = await latestAudit(prospectId);
  const ctx = (audit?.context ?? {}) as Record<string, string | undefined>;
  const city = ctx.targetCity ?? prospect.city ?? null;
  const services = [ctx.primaryService, ...(prospect.primaryServices ?? "").split(",")].map((s) => s?.trim()).filter((s): s is string => !!s && !/\bseo\b/i.test(s));
  return [...new Set(services.slice(0, 2).map((s) => [s.toLowerCase(), city].filter(Boolean).join(" ")))];
}

export async function saveGbp(workspaceId: string, userId: string, prospectId: string, g: GbpData) {
  const row = await db.gbpProfile.create({
    data: {
      workspaceId,
      prospectId,
      source: g.source,
      placeId: g.placeId,
      name: g.name,
      address: g.address,
      phone: g.phone,
      website: g.website,
      mapsUrl: g.mapsUrl,
      category: g.category,
      rating: g.rating,
      reviewCount: g.reviewCount,
      photoCount: g.photoCount,
      hasHours: g.hasHours,
      hasDescription: g.hasDescription,
      businessStatus: g.businessStatus,
      reviews: g.reviews as object,
      rankings: g.rankings as object,
    },
  });
  await logActivity({ workspaceId, prospectId, userId, type: "research.gbp_saved", message: `Google Business Profile ${g.source === "PLACES_API" ? "fetched from Google" : "entered by hand"}${g.rating != null ? ` (${g.rating.toFixed(1)}★, ${g.reviewCount ?? 0} reviews)` : ""}` });
  return row;
}

export async function fetchGbpProfile(workspaceId: string, userId: string, prospectId: string, queries?: string[], fetchImpl?: typeof fetch) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const apiKey = await getApiKey(workspaceId, "PLACES");
  if (!apiKey) throw new ResearchError("Add a Google key with the Places API enabled on the Integrations page, or enter the profile details by hand.");
  const audit = await latestAudit(prospectId);
  const city = ((audit?.context ?? {}) as Record<string, string | undefined>).targetCity ?? prospect.city ?? null;
  const q = (queries?.length ? queries : await defaultGbpQueries(workspaceId, prospectId)).map((x) => x.trim().slice(0, 120)).filter(Boolean);
  try {
    const g = await fetchGbp(apiKey, { businessName: prospect.businessName, domain: prospect.domain, city, queries: q }, fetchImpl);
    return saveGbp(workspaceId, userId, prospectId, g);
  } catch (e) {
    if (e instanceof GbpError) throw new ResearchError(e.message);
    throw e;
  }
}

export type ManualGbpInput = {
  name: string;
  category?: string;
  rating?: number | null;
  reviewCount?: number | null;
  photoCount?: number | null;
  hasHours?: boolean | null;
  hasWebsite?: boolean | null;
  hasPhone?: boolean | null;
  mapsUrl?: string | null;
  rankQuery?: string;
  rankPosition?: number | null;
  badReviewsText?: string;
};

/** Profile figures copied from the public Google profile by the user. */
export async function saveManualGbp(workspaceId: string, userId: string, prospectId: string, input: ManualGbpInput) {
  const prospect = await ownedProspect(workspaceId, prospectId);
  const g: GbpData = {
    source: "MANUAL",
    placeId: null,
    name: input.name.trim().slice(0, 200) || prospect.businessName,
    address: null,
    phone: input.hasPhone === false ? null : input.hasPhone ? "listed" : null,
    website: input.hasWebsite === false ? null : input.hasWebsite ? prospect.websiteUrl : null,
    mapsUrl: input.mapsUrl && /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page|maps\.google\.[a-z.]+)/i.test(input.mapsUrl) ? input.mapsUrl : null,
    category: input.category?.trim().slice(0, 120) || null,
    rating: input.rating ?? null,
    reviewCount: input.reviewCount ?? null,
    photoCount: input.photoCount ?? null,
    hasHours: input.hasHours ?? null,
    hasDescription: null,
    businessStatus: null,
    reviews: parsePastedReviews(input.badReviewsText ?? ""),
    rankings: input.rankQuery?.trim() ? [{ query: input.rankQuery.trim().slice(0, 120), position: input.rankPosition ?? null, total: 20, checkedAt: new Date().toISOString() }] : [],
  };
  // Unknown answers stay unknown: only explicit "no" creates an issue.
  if (input.hasPhone == null) g.phone = "unknown";
  if (input.hasWebsite == null) g.website = prospect.websiteUrl;
  return saveGbp(workspaceId, userId, prospectId, g);
}

export async function latestGbp(prospectId: string) {
  return db.gbpProfile.findFirst({ where: { prospectId }, orderBy: { fetchedAt: "desc" } });
}

export function gbpRowToData(row: NonNullable<Awaited<ReturnType<typeof latestGbp>>>): GbpData {
  return {
    source: row.source as GbpData["source"],
    placeId: row.placeId,
    name: row.name,
    address: row.address,
    phone: row.phone,
    website: row.website,
    mapsUrl: row.mapsUrl,
    category: row.category,
    rating: row.rating,
    reviewCount: row.reviewCount,
    photoCount: row.photoCount,
    hasHours: row.hasHours,
    hasDescription: row.hasDescription,
    businessStatus: row.businessStatus,
    reviews: (row.reviews as GbpData["reviews"]) ?? [],
    rankings: (row.rankings as GbpData["rankings"]) ?? [],
  };
}
