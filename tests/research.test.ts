import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { runnerOptions } from "@/lib/audit/runner";
import { startAudit } from "@/lib/audit/service";
import { decodeCsv, detectKind, detectSource, parseImport, parseNumber, readTable } from "@/lib/research/csv";
import { classifyIntent, cleanLocation, cleanServicePhrase, clusterKeywords, generateSeeds, keywordPriority, mapClusterToPage, tokens } from "@/lib/research/keywords";
import { parsePsiResponse, performanceFinding } from "@/lib/research/pagespeed";
import { addCompetitor, addManualKeywords, analyseKeywords, deleteImport, generateSeedKeywords, importCsv, observeCompetitor, ResearchError, runPerformanceTest } from "@/lib/research/service";
import { startFixtureSite } from "./fixtures/site";

const AHREFS_KEYWORDS = `"Keyword","KD","Volume","CPC","Parent Keyword","Traffic potential","Position","URL"
"dental implants leeds","12","1,300","4.50","dental implants","2400","14","https://example.com/implants"
"teeth whitening leeds","5","880","2.10","teeth whitening","900","",""
"dental implants leeds","12","1,300","4.50","dental implants","2400","14",""
"emergency dentist leeds","9","590","3.00","emergency dentist","700","",""`;

const SEMRUSH_BACKLINKS = `Page ascore,Source title,Source url,Target url,Anchor,Nofollow,First seen
12,Post,https://blog.example.org/a,https://site.example/,dentist,FALSE,2025-03-01
15,Post 2,https://blog.example.org/b,https://site.example/,smile,TRUE,2025-04-01
40,Directory,https://www.yell.example/listing,https://site.example/,Bright Smile,FALSE,2024-01-20`;

const GSC_QUERIES = `Top queries,Clicks,Impressions,CTR,Position
dental implants leeds,32,1840,1.74%,8.6
bright smile dental,120,300,40%,1.2
teeth whitening leeds,4,950,0.42%,17.3`;

describe("CSV parsing", () => {
  it("decodes UTF-16 LE exports (Ahrefs 'for Excel')", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Keyword\tVolume\nseo leeds\t50", "utf16le")]);
    expect(decodeCsv(buf)).toBe("Keyword\tVolume\nseo leeds\t50");
    const parsed = parseImport(decodeCsv(buf));
    expect(parsed.kind).toBe("KEYWORDS");
    expect(parsed.rows[0]).toMatchObject({ keyword: "seo leeds", volume: 50 });
  });
  it("parses numbers without guessing", () => {
    expect(parseNumber("1,300")).toBe(1300);
    expect(parseNumber("1.74%")).toBe(1.74);
    expect(parseNumber("$4.50")).toBe(4.5);
    expect(parseNumber("2.5K")).toBe(2500);
    expect(parseNumber("1K-10K")).toBeNull(); // Keyword Planner ranges are not turned into a number
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
  it("detects tool and data type from headers", () => {
    expect(detectSource(["Keyword", "KD", "Volume"])).toBe("AHREFS");
    expect(detectSource(["Keyword", "Keyword Difficulty", "Search Volume", "Intent"])).toBe("SEMRUSH");
    expect(detectSource(["Top queries", "Clicks", "Impressions"])).toBe("GOOGLE_SEARCH_CONSOLE");
    expect(detectKind(["Top pages", "Clicks", "Impressions", "CTR", "Position"])).toBe("GSC_PAGES");
    expect(detectKind(["Referring domain", "DR"])).toBe("BACKLINKS");
  });
  it("de-duplicates keywords and keeps blanks empty", () => {
    const p = parseImport(AHREFS_KEYWORDS);
    if (p.kind !== "KEYWORDS") throw new Error("wrong kind");
    expect(p.rows).toHaveLength(3);
    expect(p.skipped).toBe(1);
    expect(p.rows[1]).toMatchObject({ keyword: "teeth whitening leeds", volume: 880, difficulty: 5, position: null, url: null });
  });
  it("aggregates per-link backlink exports by referring domain", () => {
    const p = parseImport(SEMRUSH_BACKLINKS);
    if (p.kind !== "BACKLINKS") throw new Error("wrong kind");
    const blog = p.rows.find((r) => r.domain === "blog.example.org")!;
    expect(blog.backlinks).toBe(2);
    expect(blog.authority).toBe(15);
    expect(p.rows.find((r) => r.domain === "yell.example")).toBeTruthy();
    expect(p.authorityMetric).toMatch(/Semrush/);
  });
});

describe("keyword engine", () => {
  it("classifies intent from wording or the tool's label", () => {
    expect(classifyIntent("how long do dental implants last")).toBe("INFORMATIONAL");
    expect(classifyIntent("best dentist leeds")).toBe("COMMERCIAL");
    expect(classifyIntent("emergency dentist near me")).toBe("TRANSACTIONAL");
    expect(classifyIntent("bright smile dental", ["bright", "smile"])).toBe("NAVIGATIONAL");
    expect(classifyIntent("anything", [], "Informational, Commercial")).toBe("INFORMATIONAL");
  });
  it("generates seed ideas from services and locations only", () => {
    const seeds = generateSeeds(["Dental implants"], ["Leeds, UK"]);
    expect(seeds).toContain("dental implants leeds");
    expect(seeds).toContain("dental implants cost");
    expect(seeds.every((s) => s.includes("dental implants"))).toBe(true);
  });
  it("turns page titles into short service phrases and real place names", () => {
    expect(cleanServicePhrase("Dubai ATV Ride – Morning Desert Quad Bike Adventure from AED 150")).toBe("dubai atv ride");
    expect(cleanServicePhrase("Tour Buggy Dubaï | Prix dès 375 AED")).toBe("tour buggy dubaï");
    expect(cleanLocation("Morning Can-Am Buggy Safari in Dubai")).toBe("dubai");
    expect(cleanLocation("Lahbab Desert, Dubai, Dubai, 00000, AE")).toBe("lahbab desert");
    const seeds = generateSeeds(["Dune Buggy Dubai – Book from AED 375", "Safari en el Desierto de Dubái con Buggy, la mejor aventura del desierto para toda la familia"], ["Dubai"]);
    expect(seeds).toContain("dune buggy dubai");
    expect(seeds).not.toContain("dune buggy dubai dubai");
    expect(seeds.some((s) => s.includes("375") || s.includes("aventura"))).toBe(false);
  });
  it("finds the header row below a Keyword Planner preamble", () => {
    const kp = ["Keyword Stats 2026-10-22 at 10_00_00", "October 1, 2025 - September 30, 2026", "Keyword\tCurrency\tAvg. monthly searches", "dune buggy dubai\tAED\t2900", ""].join("\n");
    const { headers, rows } = readTable(kp);
    expect(headers).toContain("Avg. monthly searches");
    expect(rows[0]).toMatchObject({ Keyword: "dune buggy dubai" });
  });
  it("clusters related keywords and maps them to the best page", () => {
    const kws = ["dental implants leeds", "dental implants cost", "teeth whitening leeds", "teeth whitening price"].map((k, i) => ({ id: String(i), keyword: k, volume: null, difficulty: null }));
    const clusters = clusterKeywords(kws);
    expect(clusters).toHaveLength(2);
    const pages = [
      { url: "https://a.example/services/dental-implants", title: "Dental Implants in Leeds", h1: "Dental implants", pageType: "SERVICE" },
      { url: "https://a.example/about", title: "About us", h1: "About", pageType: "ABOUT" },
    ];
    expect(mapClusterToPage(tokens("dental implants"), pages).url).toBe("https://a.example/services/dental-implants");
    expect(mapClusterToPage(tokens("invisalign braces"), pages).url).toBeNull();
  });
  it("scores priority transparently and neutrally when data is missing", () => {
    const a = keywordPriority({ intent: "TRANSACTIONAL", volume: 1000, difficulty: 10, position: 12, hasPage: true });
    expect(a.parts.strikingDistance).toBe(15);
    const b = keywordPriority({ intent: "TRANSACTIONAL", volume: null, difficulty: null, position: null, hasPage: false });
    expect(b.parts.demand).toBe(10);
    expect(b.parts.gap).toBe(10);
    expect(keywordPriority({ intent: "INFORMATIONAL", volume: 10, difficulty: 90, position: null, hasPage: true }).score).toBeLessThan(a.score);
  });
});

describe("PageSpeed parsing", () => {
  const lab = { lighthouseResult: { lighthouseVersion: "12.0.0", categories: { performance: { score: 0.38 } }, audits: { "largest-contentful-paint": { numericValue: 6120 }, "total-blocking-time": { numericValue: 890 }, "cumulative-layout-shift": { numericValue: 0.214 } } } };
  it("labels lab-only results as potential, not confirmed", () => {
    const r = parsePsiResponse("https://a.example/", "MOBILE", lab);
    expect(r.lab.performanceScore).toBe(38);
    expect(r.fieldScope).toBe("NONE");
    const f = performanceFinding(r)!;
    expect(f.evidenceStatus).toBe("POTENTIAL");
    expect(f.observedFacts).toMatch(/No real-user \(field\) data/);
  });
  it("uses real-user field data for confirmed Core Web Vitals findings", () => {
    const r = parsePsiResponse("https://a.example/", "MOBILE", {
      ...lab,
      loadingExperience: { overall_category: "SLOW", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4200, category: "SLOW" }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" }, INTERACTION_TO_NEXT_PAINT: { percentile: 260, category: "AVERAGE" } } },
    });
    expect(r.fieldScope).toBe("URL");
    const f = performanceFinding(r)!;
    expect(f.evidenceStatus).toBe("CONFIRMED");
    expect(f.severity).toBe("HIGH");
    expect(f.observedFacts).toMatch(/Largest Contentful Paint 4\.2 s \(slow\)/);
    expect(f.observedFacts).toMatch(/Interaction to Next Paint 260 ms \(needs improvement\)/);
    expect(f.observedFacts).not.toMatch(/Layout Shift/);
  });
  it("returns no finding when everything passes", () => {
    const r = parsePsiResponse("https://a.example/", "DESKTOP", { lighthouseResult: { categories: { performance: { score: 0.95 } }, audits: {} } });
    expect(performanceFinding(r)).toBeNull();
  });
});

describe("research service (database)", () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let workspaceId: string;
  let userId: string;
  let prospectId: string;

  beforeAll(async () => {
    runnerOptions.allowPrivateNetworks = true;
    site = await startFixtureSite();
    const user = await db.user.create({ data: { email: `research${Date.now()}@test.example`, name: "R", passwordHash: "x" } });
    userId = user.id;
    workspaceId = (await createWorkspace("Research WS", user.id)).id;
    await db.workspaceSettings.update({ where: { workspaceId }, data: { crawlDelayMs: 250 } });
    const { audit, prospect } = await startAudit(workspaceId, userId, { websiteUrl: site.base, currency: "GBP", targetCity: "Leeds", primaryService: "Dental implants", secondaryServices: "Teeth whitening" });
    prospectId = prospect.id;
    for (let i = 0; i < 300; i++) {
      const a = await db.websiteAudit.findUniqueOrThrow({ where: { id: audit.id } });
      if (["COMPLETED", "PARTIAL", "FAILED"].includes(a.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 90_000);
  afterAll(async () => {
    runnerOptions.allowPrivateNetworks = false;
    await site.close();
  });

  it("imports keywords with provenance and labels third-party metrics as estimates", async () => {
    const r = await importCsv(workspaceId, userId, prospectId, { name: "ahrefs-keywords.csv", buffer: Buffer.from(AHREFS_KEYWORDS) });
    expect(r).toMatchObject({ kind: "KEYWORDS", source: "AHREFS", rows: 3, skipped: 1 });
    const kw = await db.keyword.findFirstOrThrow({ where: { prospectId, keyword: "dental implants leeds" } });
    expect(kw.searchVolume).toBe(1300);
    expect(kw.volumeIsEstimate).toBe(true);
    expect(kw.dataSource).toMatch(/Ahrefs export \(ahrefs-keywords\.csv\)/);
    expect(kw.importId).toBe(r.importId);
  });

  it("imports Search Console data as measured, and backlinks per domain", async () => {
    const g = await importCsv(workspaceId, userId, prospectId, { name: "Queries.csv", buffer: Buffer.from(GSC_QUERIES) }, { periodLabel: "Last 3 months" });
    expect(g.source).toBe("GOOGLE_SEARCH_CONSOLE");
    expect((await db.dataImport.findUniqueOrThrow({ where: { id: g.importId } })).isEstimate).toBe(false);
    const b = await importCsv(workspaceId, userId, prospectId, { name: "backlinks.csv", buffer: Buffer.from(SEMRUSH_BACKLINKS) });
    expect(b.rows).toBe(2);
  });

  it("rejects wrong files clearly", async () => {
    await expect(importCsv(workspaceId, userId, prospectId, { name: "x.pdf", buffer: Buffer.from("a") })).rejects.toThrow(ResearchError);
    await expect(importCsv(workspaceId, userId, prospectId, { name: "x.csv", buffer: Buffer.from("foo,bar\n1,2") })).rejects.toThrow(/Could not tell/);
    const other = await createWorkspace("Other", userId);
    await expect(importCsv(other.id, userId, prospectId, { name: "k.csv", buffer: Buffer.from(AHREFS_KEYWORDS) })).rejects.toThrow("Prospect not found");
  });

  it("generates seed ideas without metrics and maps clusters to audited pages", async () => {
    const r = await generateSeedKeywords(workspaceId, prospectId);
    expect(r.created).toBeGreaterThan(5);
    const seed = await db.keyword.findFirstOrThrow({ where: { prospectId, isSeed: true } });
    expect(seed.searchVolume).toBeNull();
    expect(seed.dataSource).toMatch(/no metrics/);

    const implants = await db.keyword.findFirstOrThrow({ where: { prospectId, keyword: "dental implants leeds" }, include: { cluster: true } });
    expect(implants.cluster!.targetUrl).toBe(`${site.base}/services/dental-implants`);
    expect(implants.intent).toBe("TRANSACTIONAL");
    // Search Console position 8.6 → striking distance boost.
    expect(implants.priority).toBeGreaterThan(70);
    const gaps = await db.keyword.count({ where: { prospectId, status: "GAP" } });
    expect(gaps).toBeGreaterThan(0);
  });

  it("adds manual keywords and re-analyses idempotently", async () => {
    expect(await addManualKeywords(workspaceId, prospectId, ["Invisalign Leeds", "invisalign leeds", ""])).toBe(1);
    const before = await db.keywordCluster.count({ where: { prospectId } });
    await analyseKeywords(workspaceId, prospectId);
    expect(await db.keywordCluster.count({ where: { prospectId } })).toBe(before);
  });

  it("removing an import strips its metrics", async () => {
    const imp = await db.dataImport.findFirstOrThrow({ where: { prospectId, kind: "KEYWORDS" } });
    await deleteImport(workspaceId, imp.id);
    const kw = await db.keyword.findFirstOrThrow({ where: { prospectId, keyword: "dental implants leeds" } });
    expect(kw.searchVolume).toBeNull();
  });

  it("observes a competitor's public site", async () => {
    // The fixture site doubles as the "competitor" so no internet access is needed.
    const p2 = await createProspect(workspaceId, userId, { businessName: "Rival", websiteUrl: "rival.example", currency: "GBP" });
    const comp = await addCompetitor(workspaceId, p2.id, { domain: site.base });
    await expect(addCompetitor(workspaceId, p2.id, { domain: site.base })).rejects.toThrow("already added");
    const data = await observeCompetitor(workspaceId, comp.id, 6);
    expect(data.pagesAnalysed).toBeGreaterThan(2);
    expect(data.servicePages.length).toBeGreaterThan(0);
    const obs = await db.competitorObservation.findFirstOrThrow({ where: { competitorId: comp.id } });
    expect(obs.isEstimate).toBe(false);
  }, 60_000);

  it("stores PageSpeed results and turns field data into an audit finding", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          lighthouseResult: { categories: { performance: { score: 0.41 } }, audits: { "largest-contentful-paint": { numericValue: 5200 } } },
          loadingExperience: { overall_category: "AVERAGE", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: "AVERAGE" } } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const { test, finding } = await runPerformanceTest(workspaceId, userId, prospectId, "MOBILE", fakeFetch);
    expect(test.performanceScore).toBe(41);
    expect(finding?.evidenceStatus).toBe("CONFIRMED");
    const saved = await db.auditFinding.findFirstOrThrow({ where: { ruleId: "perf.field-cwv-mobile", audit: { prospectId } }, include: { evidence: true } });
    expect(saved.evidence[0].method).toMatch(/PageSpeed Insights API/);
    // Re-running replaces, never duplicates.
    await runPerformanceTest(workspaceId, userId, prospectId, "MOBILE", fakeFetch);
    expect(await db.auditFinding.count({ where: { ruleId: "perf.field-cwv-mobile", audit: { prospectId } } })).toBe(1);

    const failing = (async () => new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429 })) as unknown as typeof fetch;
    await expect(runPerformanceTest(workspaceId, userId, prospectId, "DESKTOP", failing)).rejects.toThrow(/quota/);
    expect(await db.performanceTest.count({ where: { prospectId, error: { not: null } } })).toBe(1);
  });
});
