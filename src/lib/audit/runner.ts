import "server-only";
import { db } from "../db";
import { logActivity, ACTIVITY_TYPES } from "../activity";
import { crawlSite, type CrawledRecord, type CrawlResult } from "../crawler/crawl";
import { extractContacts, type ContactCandidate } from "../crawler/contacts-extract";
import { assertPublicHost, assertUrlShape, BlockedUrlError } from "../crawler/network-guard";
import type { ExtractedPage } from "../crawler/extract";
import type { PageType } from "../crawler/classify";
import { getAiProvider, AiError } from "../ai/provider";
import { getApiKey } from "../integrations";
import { runAiAnalysis } from "./ai-analysis";
import { identifyBusiness, type BusinessProfile } from "./business";
import { checkDomain, type DomainOverview } from "../research/domain";
import { captureScreenshots, type ShotTarget } from "../crawler/screenshot";
import { putFile } from "../storage";
import { domainFindings } from "./domain-findings";
import { priorityFor, runRules } from "./rules";
import { AUDIT_STAGES, type StageKey, type StageStatus } from "./stages";
import type { AuditContext, AuditInput, FindingDraft } from "./types";

type Finding = FindingDraft & { priority: number };

/** Page limit for quick (bulk) audits. */
const QUICK_PAGE_LIMIT = 12;

/** Test hook: lets the integration tests crawl a local fixture server. Never set in production. */
export const runnerOptions = { allowPrivateNetworks: false };

async function setStage(auditId: string, stage: StageKey, status: StageStatus, message?: string, output?: unknown) {
  const now = new Date();
  await db.auditRun.upsert({
    where: { auditId_stage: { auditId, stage } },
    create: {
      auditId,
      stage,
      status,
      message,
      output: output as object | undefined,
      attempts: status === "RUNNING" ? 1 : 0,
      startedAt: status === "RUNNING" ? now : undefined,
      finishedAt: status !== "RUNNING" && status !== "PENDING" ? now : undefined,
    },
    update: {
      status,
      message: message ?? null,
      ...(output !== undefined ? { output: output as object } : {}),
      ...(status === "RUNNING" ? { startedAt: now, finishedAt: null, attempts: { increment: 1 } } : {}),
      ...(status !== "RUNNING" && status !== "PENDING" ? { finishedAt: now } : {}),
    },
  });
}

async function stageDone(auditId: string, stage: StageKey) {
  const r = await db.auditRun.findUnique({ where: { auditId_stage: { auditId, stage } } });
  return r && (r.status === "COMPLETED" || r.status === "SKIPPED" || r.status === "PARTIAL") ? r : null;
}

/** Runs a stage once; completed stages are skipped on retry. Errors mark the stage FAILED and are rethrown. */
async function stage<T>(auditId: string, key: StageKey, fn: () => Promise<{ status?: StageStatus; message?: string; output?: unknown; value: T }>, restore: () => Promise<T>): Promise<T> {
  if (await stageDone(auditId, key)) return restore();
  await setStage(auditId, key, "RUNNING");
  try {
    const r = await fn();
    await setStage(auditId, key, r.status ?? "COMPLETED", r.message, r.output);
    return r.value;
  } catch (e) {
    await setStage(auditId, key, "FAILED", e instanceof Error ? e.message.slice(0, 500) : "Unexpected error");
    throw e;
  }
}

// Stored in their own CrawledPage columns, so left out of the `details` blob.
const COLUMN_FIELDS = new Set([
  "title", "metaDescription", "canonical", "robotsMeta", "lang", "h1", "headings", "wordCount",
  "internalLinks", "externalLinks", "images", "structuredData", "textExcerpt", "contentHash",
]);

function pageDetails(p: CrawledRecord) {
  if (!p.page) return null;
  const rest = Object.fromEntries(Object.entries(p.page).filter(([k]) => !COLUMN_FIELDS.has(k)));
  return { ...rest, text: p.page.text.slice(0, 60_000), rawWordCount: p.rawWordCount };
}

async function persistCrawl(auditId: string, result: CrawlResult) {
  await db.crawledPage.deleteMany({ where: { auditId } });
  for (const p of result.pages) {
    await db.crawledPage.create({
      data: {
        auditId,
        url: p.url,
        finalUrl: p.finalUrl,
        httpStatus: p.status,
        title: p.page?.title,
        metaDescription: p.page?.metaDescription,
        canonical: p.page?.canonical,
        h1: p.page?.h1,
        headings: p.page?.headings,
        wordCount: p.page?.wordCount,
        internalLinks: p.page?.internalLinks,
        externalLinks: p.page?.externalLinks,
        images: p.page?.images,
        structuredData: p.page?.structuredData as object | undefined,
        robotsMeta: p.page?.robotsMeta,
        xRobotsTag: p.xRobotsTag,
        lang: p.page?.lang,
        pageType: p.pageType,
        contentHash: p.page?.contentHash,
        textExcerpt: p.page?.textExcerpt,
        rendered: p.rendered,
        responseTimeMs: p.responseTimeMs,
        bytes: p.bytes,
        extractionError: p.error,
        redirectChain: p.redirectChain,
        discoveredVia: p.discoveredVia,
        linkedFrom: p.linkedFrom,
        details: pageDetails(p) as object | undefined,
      },
    });
  }
  await db.crawlJob.update({
    where: { auditId },
    data: {
      pagesCrawled: result.pages.length,
      robotsTxt: result.robots.body,
      sitemapUrls: result.sitemaps.urls.slice(0, 2000),
      status: "COMPLETED",
      finishedAt: new Date(),
      meta: {
        homepageUrl: result.homepageUrl,
        origin: result.origin,
        robots: {
          found: result.robots.found,
          status: result.robots.status,
          error: result.robots.error,
          sitemaps: result.robots.sitemaps,
          blocksEverything: result.robots.blocksEverything,
          blocksGooglebotHomepage: result.robots.blocksGooglebotHomepage,
          crawlDelaySec: result.robots.crawlDelaySec,
        },
        sitemapChecks: result.sitemaps.checked,
        llmsTxt: result.llmsTxt,
        httpToHttps: result.httpToHttps,
        skipped: result.skipped.slice(0, 500),
        limitReached: result.limitReached,
      },
    },
  });
}

/** Rebuilds the rule input from saved records, so analysis stages can be retried without re-crawling. */
async function loadAuditInput(auditId: string, context: AuditContext): Promise<AuditInput> {
  const [job, pages] = await Promise.all([
    db.crawlJob.findUniqueOrThrow({ where: { auditId } }),
    db.crawledPage.findMany({ where: { auditId }, orderBy: { crawledAt: "asc" } }),
  ]);
  const meta = job.meta as {
    homepageUrl: string;
    origin: string;
    robots: AuditInput["robots"];
    sitemapChecks: AuditInput["sitemaps"]["checked"];
    llmsTxt?: AuditInput["llmsTxt"];
    httpToHttps: AuditInput["httpToHttps"];
    skipped: AuditInput["skipped"];
    limitReached: boolean;
  };
  const records: CrawledRecord[] = pages.map((p) => {
    const d = p.details as (Omit<ExtractedPage, "title"> & { rawWordCount: number | null }) | null;
    return {
      url: p.url,
      finalUrl: p.finalUrl,
      status: p.httpStatus,
      redirectChain: (p.redirectChain as CrawledRecord["redirectChain"]) ?? [],
      responseTimeMs: p.responseTimeMs,
      bytes: p.bytes,
      contentType: null,
      xRobotsTag: p.xRobotsTag,
      page: d
        ? {
            ...d,
            title: p.title,
            metaDescription: p.metaDescription,
            canonical: p.canonical,
            robotsMeta: p.robotsMeta,
            lang: p.lang,
            h1: (p.h1 as string[]) ?? [],
            headings: (p.headings as ExtractedPage["headings"]) ?? [],
            wordCount: p.wordCount ?? 0,
            internalLinks: (p.internalLinks as ExtractedPage["internalLinks"]) ?? [],
            externalLinks: (p.externalLinks as ExtractedPage["externalLinks"]) ?? [],
            images: (p.images as ExtractedPage["images"]) ?? [],
            structuredData: (p.structuredData as ExtractedPage["structuredData"]) ?? { types: [], jsonLdErrors: 0, items: [] },
            textExcerpt: p.textExcerpt ?? "",
            contentHash: p.contentHash ?? "",
          }
        : null,
      pageType: p.pageType as PageType | null,
      rendered: p.rendered,
      rawWordCount: d?.rawWordCount ?? null,
      error: p.extractionError,
      discoveredVia: (p.discoveredVia as CrawledRecord["discoveredVia"]) ?? "link",
      linkedFrom: p.linkedFrom,
    };
  });
  return {
    homepageUrl: meta.homepageUrl,
    origin: meta.origin,
    robots: { ...meta.robots, body: job.robotsTxt },
    sitemaps: { checked: meta.sitemapChecks, urls: (job.sitemapUrls as string[]) ?? [] },
    llmsTxt: meta.llmsTxt,
    httpToHttps: meta.httpToHttps,
    pages: records,
    skipped: meta.skipped,
    limitReached: meta.limitReached,
    pageLimit: job.pageLimit,
    context,
    collectedAt: job.finishedAt ?? new Date(),
  };
}

/**
 * Findings that are easy to show in a picture. The highlighted elements get a red outline;
 * mobile issues are shot on a phone-sized screen.
 */
const VISUAL_FINDINGS: Record<string, { highlight?: string; device?: "mobile" }> = {
  "onpage.image-alt-missing": { highlight: 'img:not([alt]), img[alt=""]' },
  "onpage.h1-multiple": { highlight: "h1" },
  "cro.no-click-to-call-home": { device: "mobile" },
  "tech.viewport-missing": { device: "mobile" },
  "cro.no-contact-path": {},
  "tech.homepage-error": {},
  "tech.broken-internal-urls": {},
  "tech.js-dependent-content": {},
  "onpage.h1-missing": {},
  "local.target-city-absent": {},
  "domain.no-analytics": {},
};
const MAX_FINDING_SHOTS = 3;

/** Which findings get a screenshot: visual ones first, then the highest priority confirmed ones. */
export function pickScreenshotFindings(findings: Finding[]) {
  const seen = new Set<string>();
  return findings
    .filter((f) => ["CRITICAL", "HIGH", "MEDIUM"].includes(f.severity) && f.evidenceStatus !== "HYPOTHESIS" && f.affectedUrls[0])
    .sort((a, b) => Number(b.ruleId in VISUAL_FINDINGS) - Number(a.ruleId in VISUAL_FINDINGS) || b.priority - a.priority)
    .filter((f) => !seen.has(f.ruleId) && (seen.add(f.ruleId), true))
    .slice(0, MAX_FINDING_SHOTS);
}

/** A finding without evidence cannot be presented as confirmed. */
export function validateEvidence(findings: Finding[]) {
  let downgraded = 0;
  const out = findings.map((f) => {
    if (f.evidence.length === 0 || f.affectedUrls.length === 0) {
      downgraded++;
      return { ...f, severity: "NEEDS_VERIFICATION" as const, evidenceStatus: "HYPOTHESIS" as const, confidence: "LOW" as const, requiresHumanReview: true };
    }
    return f;
  });
  return { findings: out, downgraded };
}

async function saveContacts(prospectId: string, candidates: ContactCandidate[]) {
  let created = 0;
  for (const c of candidates) {
    const source = c.sources[0];
    const exists = await db.prospectContact.findUnique({ where: { prospectId_type_value: { prospectId, type: c.type, value: c.value } } });
    if (exists) {
      // Never override a person's manual edits/verification; only attach a source if missing.
      if (!exists.sourceUrl && source) await db.prospectContact.update({ where: { id: exists.id }, data: { sourceUrl: source.url } });
      continue;
    }
    await db.prospectContact.create({
      data: {
        prospectId,
        type: c.type,
        value: c.value,
        label: c.sources.map((s) => s.method).filter((v, i, a) => a.indexOf(v) === i).join(", ").slice(0, 100),
        sourceUrl: source?.url,
        sourceMethod: "CRAWL",
        extractedAt: new Date(),
        validationStatus: c.validationStatus,
        confidence: c.confidence,
        verified: false,
        hasConflict: c.hasConflict,
        conflictNote: c.conflictNote,
      },
    });
    created++;
  }
  return created;
}

function deterministicSummary(business: BusinessProfile, input: AuditInput, findings: Finding[]) {
  const ok = input.pages.filter((p) => p.page && (p.status ?? 0) < 400).length;
  const by = (s: string) => findings.filter((f) => f.severity === s).length;
  const confirmed = findings.filter((f) => f.evidenceStatus === "CONFIRMED" && !["OPPORTUNITY", "NEEDS_VERIFICATION"].includes(f.severity));
  const top = confirmed.slice(0, 3).map((f) => f.title.toLowerCase());
  return [
    `We crawled ${ok} public page${ok === 1 ? "" : "s"} of ${new URL(input.homepageUrl).hostname}${business.name ? ` (${business.name.value}, inferred from the site)` : ""}${input.limitReached ? `, stopping at the ${input.pageLimit}-page limit` : ""}.`,
    `The audit produced ${confirmed.length} confirmed issue${confirmed.length === 1 ? "" : "s"} (${by("CRITICAL")} critical, ${by("HIGH")} high, ${by("MEDIUM")} medium, ${by("LOW")} low), ${by("OPPORTUNITY")} growth opportunit${by("OPPORTUNITY") === 1 ? "y" : "ies"} and ${by("NEEDS_VERIFICATION")} item${by("NEEDS_VERIFICATION") === 1 ? "" : "s"} that need more data to verify.`,
    top.length ? `The highest-priority confirmed items are: ${top.join("; ")}.` : "No confirmed high-priority technical issues were found in the crawled pages.",
    "Rankings, organic traffic, index coverage and backlinks were not measured: they need Search Console and backlink data.",
  ].join(" ");
}

export async function runAudit(auditId: string) {
  const audit = await db.websiteAudit.findUniqueOrThrow({ where: { id: auditId }, include: { prospect: true, crawlJob: true } });
  const context = (audit.context ?? {}) as AuditContext;
  const guard = { allowPrivateNetworks: runnerOptions.allowPrivateNetworks };

  await db.websiteAudit.update({ where: { id: auditId }, data: { status: "RUNNING", startedAt: audit.startedAt ?? new Date() } });
  if (["NEW_PROSPECT", "AUDIT_COMPLETED"].includes(audit.prospect.status)) {
    await db.prospect.update({ where: { id: audit.prospectId }, data: { status: "AUDIT_IN_PROGRESS" } });
  }

  try {
    await stage(
      auditId,
      "URL_VALIDATION",
      async () => {
        const u = assertUrlShape(audit.normalizedUrl, guard);
        const addresses = await assertPublicHost(u.hostname, guard).catch((e) => {
          if (e instanceof BlockedUrlError) throw e;
          throw new Error(`The domain ${u.hostname} could not be resolved (DNS lookup failed).`);
        });
        return { value: undefined, message: `${u.hostname} resolves to a public address`, output: { host: u.hostname, addressCount: addresses.length } };
      },
      async () => undefined,
    );

    const input = await stage(
      auditId,
      "CRAWL",
      async () => {
        const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: audit.workspaceId } });
        const pageLimit = Math.min(Math.max(settings?.crawlPageLimit ?? 40, 1), context.quick ? QUICK_PAGE_LIMIT : 200);
        const delayMs = Math.max(settings?.crawlDelayMs ?? 800, 250);
        await db.crawlJob.upsert({
          where: { auditId },
          create: { auditId, pageLimit, delayMs, status: "RUNNING", startedAt: new Date() },
          update: { pageLimit, delayMs, status: "RUNNING", startedAt: new Date(), error: null },
        });
        await setStage(auditId, "DISCOVERY", "RUNNING");
        let discoveryMarked = false;
        let lastWrite = 0;
        const result = await crawlSite(audit.normalizedUrl, {
          ...guard,
          pageLimit,
          delayMs,
          onProgress: async ({ crawled, found, current }) => {
            if (!discoveryMarked) {
              discoveryMarked = true;
              await setStage(auditId, "DISCOVERY", "COMPLETED", "robots.txt and sitemaps checked");
            }
            if (Date.now() - lastWrite > 1500 || !current) {
              lastWrite = Date.now();
              await db.crawlJob.update({ where: { auditId }, data: { pagesCrawled: crawled, pagesFound: found } });
              await db.auditRun.update({
                where: { auditId_stage: { auditId, stage: "CRAWL" } },
                data: { message: current ? `${crawled} of up to ${pageLimit} pages crawled · ${current}` : `${crawled} pages crawled` },
              });
            }
          },
        });
        await setStage(auditId, "DISCOVERY", "COMPLETED", `robots.txt ${result.robots.found ? "found" : "not found"}; ${result.sitemaps.urls.length} sitemap URLs`, {
          robotsFound: result.robots.found,
          sitemapUrls: result.sitemaps.urls.length,
          sitemaps: result.sitemaps.checked,
        });
        await persistCrawl(auditId, result);
        const ok = result.pages.filter((p) => p.page).length;
        if (ok === 0) throw new Error(`No HTML pages could be analysed (${result.pages[0]?.error ?? `HTTP ${result.pages[0]?.status}`}).`);
        // 4xx/5xx pages and redirects are findings, not crawl failures; only unreachable URLs make the crawl partial.
        const unreachable = result.pages.filter((p) => p.status === null).length;
        return {
          value: await loadAuditInput(auditId, context),
          status: unreachable > 0 ? "PARTIAL" : "COMPLETED",
          message: `${ok} pages analysed${unreachable ? `, ${unreachable} could not be fetched` : ""}${result.limitReached ? " (page limit reached)" : ""}`,
          output: { analysed: ok, attempted: result.pages.length, skipped: result.skipped.length, limitReached: result.limitReached },
        };
      },
      () => loadAuditInput(auditId, context),
    );

    const contacts = extractContacts(
      input.pages.filter((p) => p.page && p.finalUrl).map((p) => ({ url: p.finalUrl!, pageType: p.pageType ?? "OTHER", page: p.page! })),
    );

    const business = await stage(
      auditId,
      "BUSINESS_IDENTIFICATION",
      async () => {
        const profile = identifyBusiness(input.pages, contacts);
        // A prospect created from just a URL is named after its domain; replace that placeholder (still unverified).
        if (profile.name && audit.prospect.businessName === audit.prospect.domain) {
          await db.prospect.update({ where: { id: audit.prospectId }, data: { businessName: profile.name.value } });
        }
        return {
          value: profile,
          output: profile,
          message: profile.name ? `Likely business name: ${profile.name.value} (unverified)` : "Business name could not be inferred",
          status: profile.name ? "COMPLETED" : "PARTIAL",
        };
      },
      async () => ((await stageDone(auditId, "BUSINESS_IDENTIFICATION"))!.output as BusinessProfile),
    );

    const allFindings = runRules(input);
    const isTechnical = (f: Finding) => f.category === "Technical SEO" || f.category === "On-Page SEO";
    await stage(
      auditId,
      "TECHNICAL",
      async () => {
        const n = allFindings.filter(isTechnical).length;
        return { value: undefined, message: `${n} technical and on-page findings`, output: { count: n } };
      },
      async () => undefined,
    );
    await stage(
      auditId,
      "CONTENT",
      async () => {
        const n = allFindings.filter((f) => !isTechnical(f)).length;
        return { value: undefined, message: `${n} content, local, conversion and data-access findings`, output: { count: n } };
      },
      async () => undefined,
    );

    // Free public checks of the domain itself; findings join the crawl findings below.
    const domainExtra = await stage(
      auditId,
      "DOMAIN",
      async () => {
        const host = new URL(input.homepageUrl).hostname;
        if (guard.allowPrivateNetworks || !host.includes(".") || /^[\d.]+$|:/.test(host)) {
          return { value: [] as Finding[], status: "SKIPPED", message: "Not a public domain name" };
        }
        const overview = await Promise.race([
          checkDomain(host, { guard, popularity: false }),
          new Promise<null>((r) => setTimeout(() => r(null), 45_000)),
        ]).catch(() => null);
        const answered = overview ? (["registration", "ssl", "email", "tech"] as const).filter((k) => overview[k].ok) : [];
        if (!overview || answered.length === 0) {
          return { value: [] as Finding[], status: "SKIPPED", message: "The free domain sources did not respond; check it later from Research → Domain overview" };
        }
        const found = domainFindings(overview, input.homepageUrl).map((f) => ({ ...f, priority: priorityFor(f, input) }));
        return {
          value: found,
          output: overview,
          message: `${found.length} domain finding${found.length === 1 ? "" : "s"} (checked: ${answered.join(", ")})`,
        };
      },
      async () => {
        const r = await stageDone(auditId, "DOMAIN");
        const overview = r?.output as DomainOverview | null;
        return overview?.registration ? domainFindings(overview, input.homepageUrl, new Date(overview.checkedAt).getTime()).map((f) => ({ ...f, priority: priorityFor(f, input) })) : [];
      },
    );
    const combined = [...allFindings, ...domainExtra].sort((a, b) => b.priority - a.priority);

    for (const [key, msg] of [
      ["KEYWORDS", "Keyword research needs a keyword data source (CSV import or API) — available in the research module"],
      ["COMPETITORS", "Competitor research runs separately once competitors are added — available in the research module"],
    ] as const) {
      if (!(await stageDone(auditId, key))) await setStage(auditId, key, "SKIPPED", msg);
    }

    await stage(
      auditId,
      "CONTACTS",
      async () => {
        const created = await saveContacts(audit.prospectId, contacts);
        if (created) {
          await logActivity({
            workspaceId: audit.workspaceId,
            prospectId: audit.prospectId,
            type: ACTIVITY_TYPES.CONTACT_UPDATED,
            message: `${created} public contact detail${created === 1 ? "" : "s"} extracted from the website (unverified)`,
          });
        }
        return {
          value: undefined,
          message: `${contacts.length} public contact details found, ${created} new`,
          output: { found: contacts.length, created, byType: contacts.reduce<Record<string, number>>((a, c) => ((a[c.type] = (a[c.type] ?? 0) + 1), a), {}) },
          status: contacts.some((c) => c.type === "EMAIL" || c.type === "PHONE") ? "COMPLETED" : "PARTIAL",
        };
      },
      async () => undefined,
    );

    const findings = await stage(
      auditId,
      "EVIDENCE_VALIDATION",
      async () => {
        const { findings: validated, downgraded } = validateEvidence(combined);
        await db.$transaction(async (tx) => {
          await tx.auditFinding.deleteMany({ where: { auditId, ruleId: { not: "CUSTOM" } } });
          for (const f of validated) {
            await tx.auditFinding.create({
              data: {
                auditId,
                ruleId: f.ruleId,
                category: f.category,
                title: f.title,
                severity: f.severity,
                evidenceStatus: f.evidenceStatus,
                affectedUrls: f.affectedUrls.slice(0, 200),
                observedFacts: f.observedFacts,
                businessImpact: f.businessImpact,
                recommendation: f.recommendation,
                complexity: f.complexity,
                priority: f.priority,
                confidence: f.confidence,
                verificationMethod: f.verificationMethod,
                requiresAccess: f.requiresAccess ?? false,
                requiresHumanReview: f.requiresHumanReview ?? false,
                includeInProposal: f.severity !== "NEEDS_VERIFICATION" || f.category === "Data & access",
                evidence: {
                  create: f.evidence.map((e) => ({
                    auditId,
                    kind: e.kind,
                    url: e.url,
                    excerpt: e.excerpt?.slice(0, 4000),
                    measurement: e.measurement as object | undefined,
                    method: e.method,
                    collectedAt: input.collectedAt,
                  })),
                },
              },
            });
          }
        });
        return {
          value: validated,
          message: `${validated.length} findings saved with evidence${downgraded ? `; ${downgraded} downgraded for missing evidence` : ""}`,
          output: { saved: validated.length, downgraded },
        };
      },
      async () => combined,
    );

    await stage(
      auditId,
      "SCREENSHOTS",
      async () => {
        if (process.env.DISABLE_SCREENSHOTS === "true") return { value: undefined, status: "SKIPPED", message: "Screenshots are turned off (DISABLE_SCREENSHOTS)" };
        const picked = pickScreenshotFindings(findings);
        const targets: (ShotTarget & { kind: string; ruleId?: string; caption: string })[] = [
          { url: input.homepageUrl, device: "desktop", kind: "HOMEPAGE_DESKTOP", caption: "Homepage on a computer" },
          { url: input.homepageUrl, device: "mobile", kind: "HOMEPAGE_MOBILE", caption: "Homepage on a phone" },
          ...picked.map((f) => ({
            url: f.affectedUrls[0],
            device: VISUAL_FINDINGS[f.ruleId]?.device ?? ("desktop" as const),
            highlight: VISUAL_FINDINGS[f.ruleId]?.highlight,
            label: f.title,
            kind: "FINDING",
            ruleId: f.ruleId,
            caption: f.title,
          })),
        ];
        const shots = await captureScreenshots(targets, guard);
        await db.auditScreenshot.deleteMany({ where: { auditId } });
        let saved = 0;
        for (const [i, t] of targets.entries()) {
          const img = shots[i];
          if (!img) continue;
          const storageKey = `screenshots/${audit.workspaceId}/${auditId}/${i}-${t.kind.toLowerCase()}.jpg`;
          await putFile(storageKey, img);
          await db.auditScreenshot.create({ data: { auditId, kind: t.kind, ruleId: t.ruleId, url: t.url, storageKey, caption: t.caption } });
          saved++;
        }
        if (!saved) return { value: undefined, status: "SKIPPED", message: "The pages could not be photographed (browser unavailable or the site did not load)" };
        return { value: undefined, message: `${saved} screenshot${saved === 1 ? "" : "s"} saved for the report and proposal`, output: { saved, attempted: targets.length } };
      },
      async () => undefined,
    );

    const ai = await stage(
      auditId,
      "AI_ANALYSIS",
      async () => {
        const provider = getAiProvider(await getApiKey(audit.workspaceId, "GEMINI"));
        if (!provider) {
          return { value: null, status: "SKIPPED", message: "No AI provider configured (add GEMINI_API_KEY). The rule-based summary is used instead." };
        }
        try {
          const result = await runAiAnalysis(provider, business, findings);
          return { value: result, output: { provider: provider.name, model: provider.model, ...result }, message: `${provider.name} (${provider.model})` };
        } catch (e) {
          // AI is optional: the audit stays valid without it.
          const msg = e instanceof AiError ? e.message : "AI analysis failed";
          return { value: null, status: "FAILED", message: msg };
        }
      },
      async () => {
        const r = await stageDone(auditId, "AI_ANALYSIS");
        return (r?.output as Awaited<ReturnType<typeof runAiAnalysis>> | null) ?? null;
      },
    );

    await stage(
      auditId,
      "REPORT",
      async () => {
        const summary = ai?.executiveSummary ?? deterministicSummary(business, input, findings);
        const severities = findings.reduce<Record<string, number>>((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {});
        const categories = findings.reduce<Record<string, number>>((a, f) => ((a[f.category] = (a[f.category] ?? 0) + 1), a), {});
        const pageTypes = input.pages.reduce<Record<string, number>>((a, p) => (p.pageType ? ((a[p.pageType] = (a[p.pageType] ?? 0) + 1), a) : a), {});
        await db.websiteAudit.update({
          where: { id: auditId },
          data: {
            summary,
            analysis: {
              business,
              severities,
              categories,
              pageTypes,
              summarySource: ai ? "AI (validated against findings)" : "Rule-based",
              ai: ai ?? null,
              scope: {
                pagesAttempted: input.pages.length,
                pagesAnalysed: input.pages.filter((p) => p.page).length,
                pageLimit: input.pageLimit,
                limitReached: input.limitReached,
                skipped: input.skipped.length,
                rendered: input.pages.filter((p) => p.rendered).length,
                collectedAt: input.collectedAt.toISOString(),
              },
              limitations: [
                "Only publicly reachable pages within the crawl limit were analysed.",
                "Rankings, organic traffic, index coverage and click data were not measured (Search Console needed).",
                "Backlinks, domain metrics and keyword volumes were not measured (third-party data needed).",
                "Core Web Vitals were not measured; server response times are single measurements from the audit server.",
                "Conversion performance cannot be judged from the website alone (analytics needed).",
              ],
            },
          },
        });
        return { value: undefined, message: ai ? "Summary written by AI from validated findings" : "Rule-based summary generated" };
      },
      async () => undefined,
    );

    await stage(
      auditId,
      "PROPOSAL_READINESS",
      async () => {
        const proposalReady = findings.filter((f) => f.severity !== "NEEDS_VERIFICATION").length;
        const hasRecipient = await db.prospectContact.count({ where: { prospectId: audit.prospectId, type: { in: ["EMAIL", "WHATSAPP", "PHONE"] } } });
        const notes = [
          `${proposalReady} findings can be used in a proposal`,
          hasRecipient ? "contact details available — verify before outreach" : "no email/phone found — add one manually before outreach",
        ];
        return { value: undefined, message: notes.join("; "), status: proposalReady > 0 ? "COMPLETED" : "PARTIAL", output: { proposalReady, hasRecipient: hasRecipient > 0 } };
      },
      async () => undefined,
    );

    const runs = await db.auditRun.findMany({ where: { auditId } });
    const partial = runs.some((r) => r.status === "FAILED" || r.status === "PARTIAL");
    await db.websiteAudit.update({ where: { id: auditId }, data: { status: partial ? "PARTIAL" : "COMPLETED", completedAt: new Date() } });
    const prospect = await db.prospect.findUniqueOrThrow({ where: { id: audit.prospectId } });
    if (prospect.status === "AUDIT_IN_PROGRESS" || prospect.status === "NEW_PROSPECT") {
      await db.prospect.update({ where: { id: audit.prospectId }, data: { status: "AUDIT_COMPLETED" } });
    }
    await logActivity({
      workspaceId: audit.workspaceId,
      prospectId: audit.prospectId,
      type: ACTIVITY_TYPES.AUDIT_COMPLETED,
      message: `Website audit ${partial ? "completed with some limitations" : "completed"}: ${findings.length} findings`,
      metadata: { auditId },
    });
  } catch (e) {
    // Mark remaining stages so the UI does not show them as still pending forever.
    const runs = await db.auditRun.findMany({ where: { auditId } });
    const seen = new Set(runs.map((r) => r.stage));
    for (const s of AUDIT_STAGES) if (!seen.has(s.key)) await setStage(auditId, s.key, "PENDING");
    // A sub-stage started inside the failed one (e.g. DISCOVERY during CRAWL) must not stay "running".
    await db.auditRun.updateMany({ where: { auditId, status: "RUNNING" }, data: { status: "FAILED", message: `Stopped: ${(e as Error).message ?? "unexpected error"}`.slice(0, 500), finishedAt: new Date() } });
    await db.websiteAudit.update({ where: { id: auditId }, data: { status: "FAILED" } });
    await db.crawlJob.updateMany({ where: { auditId, status: "RUNNING" }, data: { status: "FAILED", error: (e as Error).message?.slice(0, 500) } });
    const prospect = await db.prospect.findUnique({ where: { id: audit.prospectId } });
    if (prospect?.status === "AUDIT_IN_PROGRESS") await db.prospect.update({ where: { id: audit.prospectId }, data: { status: "NEW_PROSPECT" } });
    throw e;
  }
}
