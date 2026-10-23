import robotsParser from "robots-parser";
import { jaccard } from "../crawler/extract";
import type { CrawledRecord } from "../crawler/crawl";
import type { AuditInput, FindingDraft, Severity } from "./types";

/**
 * Deterministic, evidence-based checks. Each rule only reports what the collected data shows,
 * states the scope it inspected, and uses NEEDS_VERIFICATION / POTENTIAL when the data cannot
 * prove a problem on its own. No rule claims rankings, traffic, indexing or backlink facts.
 */

type OkPage = CrawledRecord & { page: NonNullable<CrawledRecord["page"]>; finalUrl: string };

const IMPORTANT_TYPES = new Set(["HOMEPAGE", "SERVICE", "LOCATION", "PRODUCT", "CONTACT", "PRICING", "BOOKING"]);
const list = (urls: string[], max = 5) => urls.slice(0, max).join(", ") + (urls.length > max ? ` and ${urls.length - max} more` : "");
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function okPages(input: AuditInput): OkPage[] {
  const seen = new Set<string>();
  return input.pages.filter((p): p is OkPage => {
    if (!p.page || !p.finalUrl || (p.status ?? 0) >= 400 || seen.has(p.finalUrl)) return false;
    seen.add(p.finalUrl);
    return true;
  });
}

function scopeNote(input: AuditInput) {
  const n = okPages(input).length;
  return `${plural(n, "HTML page")} analysed${input.limitReached ? ` (crawl stopped at the configured limit of ${input.pageLimit} pages)` : ""}`;
}

type Rule = (input: AuditInput) => FindingDraft[];

// ───────────────────────────── Technical ─────────────────────────────

const robotsRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const r = input.robots;
  if (r.blocksEverything || r.blocksGooglebotHomepage) {
    out.push({
      ruleId: "tech.robots-blocks-site",
      category: "Technical SEO",
      title: "robots.txt blocks search engines from the whole site",
      severity: "CRITICAL",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [`${input.origin}/robots.txt`],
      observedFacts: `robots.txt disallows the homepage for ${r.blocksEverything ? "all crawlers (User-agent: *)" : "Googlebot"}.`,
      businessImpact: "Search engines are instructed not to crawl the site, so its pages cannot be properly discovered or refreshed in search results.",
      recommendation: "Remove the site-wide Disallow rule (unless the site is intentionally private) and re-test in Google Search Console's robots.txt report.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-fetch robots.txt and confirm the homepage is allowed; check Search Console's robots.txt report.",
      evidence: [{ kind: "ROBOTS_TXT", url: `${input.origin}/robots.txt`, excerpt: r.body?.slice(0, 800), method: "Fetched robots.txt and evaluated rules for * and Googlebot" }],
    });
  } else if (r.status !== null && r.status >= 500) {
    out.push({
      ruleId: "tech.robots-server-error",
      category: "Technical SEO",
      title: "robots.txt returns a server error",
      severity: "HIGH",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [`${input.origin}/robots.txt`],
      observedFacts: `robots.txt returned HTTP ${r.status}.`,
      businessImpact: "Google may temporarily stop crawling a site whose robots.txt returns server errors.",
      recommendation: "Make robots.txt return HTTP 200 (or 404 if you do not need one).",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-fetch robots.txt and confirm a 200 or 404 status.",
      evidence: [{ kind: "HTTP_STATUS", url: `${input.origin}/robots.txt`, measurement: { status: r.status }, method: "HTTP GET" }],
    });
  } else if (!r.found) {
    out.push({
      ruleId: "tech.robots-missing",
      category: "Technical SEO",
      title: "No robots.txt file",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [`${input.origin}/robots.txt`],
      observedFacts: `${input.origin}/robots.txt returned ${r.status ? `HTTP ${r.status}` : "no response"}${r.error ? ` (${r.error})` : ""}.`,
      businessImpact: "Not harmful on its own (everything is crawlable), but a robots.txt is the standard place to point crawlers at the XML sitemap.",
      recommendation: "Add a minimal robots.txt that references the XML sitemap.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Fetch /robots.txt and confirm HTTP 200.",
      evidence: [{ kind: "HTTP_STATUS", url: `${input.origin}/robots.txt`, measurement: { status: r.status }, method: "HTTP GET" }],
    });
  }
  return out;
};

// ───────────────────────────── AI search ─────────────────────────────

/** Crawlers that fetch pages so AI assistants can cite them in answers (not the ones that collect training data). */
const AI_SEARCH_BOTS = [
  { ua: "OAI-SearchBot", name: "ChatGPT search" },
  { ua: "ChatGPT-User", name: "ChatGPT (pages opened from a chat)" },
  { ua: "PerplexityBot", name: "Perplexity" },
  { ua: "Claude-SearchBot", name: "Claude search" },
];

const aiSearchRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const r = input.robots;
  const robotsUrl = `${input.origin}/robots.txt`;
  // A site-wide block is already reported as its own, more serious finding.
  if (r.found && r.body && !r.blocksEverything) {
    const robots = robotsParser(robotsUrl, r.body);
    const blocked = AI_SEARCH_BOTS.filter((b) => robots.isDisallowed(`${input.origin}/`, b.ua) === true);
    if (blocked.length) {
      out.push({
        ruleId: "ai.search-bots-blocked",
        category: "AI search",
        title: `robots.txt blocks AI search assistants (${blocked.map((b) => b.name.split(" (")[0]).join(", ")})`,
        severity: "MEDIUM",
        evidenceStatus: "CONFIRMED",
        affectedUrls: [robotsUrl],
        observedFacts: `robots.txt disallows the homepage for ${blocked.map((b) => `${b.ua} (${b.name})`).join(", ")}.`,
        businessImpact: "More people now ask AI assistants which business to choose. When their search crawlers are blocked, the assistants cannot read the site, so it is less likely to be mentioned or linked in their answers.",
        recommendation: "Unless blocking them is a deliberate choice, allow these user agents in robots.txt. Blocking AI training crawlers such as GPTBot or Google-Extended is a separate decision and is not affected.",
        complexity: "LOW",
        confidence: "HIGH",
        verificationMethod: "Re-fetch robots.txt and check the rules for each user agent listed.",
        evidence: [{ kind: "ROBOTS_TXT", url: robotsUrl, excerpt: r.body.slice(0, 800), method: "Evaluated robots.txt rules for AI search user agents" }],
      });
    }
  }
  if (input.llmsTxt && !input.llmsTxt.found) {
    out.push({
      ruleId: "ai.llms-txt-missing",
      category: "AI search",
      title: "No llms.txt summary for AI assistants",
      severity: "OPPORTUNITY",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [`${input.origin}/llms.txt`],
      observedFacts: `${input.origin}/llms.txt ${input.llmsTxt.status ? `returned HTTP ${input.llmsTxt.status}` : "could not be fetched"} — no plain-text file was found.`,
      businessImpact: "llms.txt is a new, optional convention: a short plain-text summary of the business and its key pages for AI tools. Google has not said it uses it, so it is a low-cost extra, not a ranking factor.",
      recommendation: "Add a short /llms.txt with the business name, what it offers, where it operates, and links to the main service and contact pages.",
      complexity: "LOW",
      confidence: "MEDIUM",
      verificationMethod: "Fetch /llms.txt and confirm HTTP 200 with plain text.",
      evidence: [{ kind: "HTTP_STATUS", url: `${input.origin}/llms.txt`, measurement: { status: input.llmsTxt.status }, method: "HTTP GET" }],
    });
  }
  return out;
};

const sitemapRules: Rule = (input) => {
  const urlsets = input.sitemaps.checked.filter((c) => c.kind === "urlset" || c.kind === "index");
  if (urlsets.length === 0) {
    return [
      {
        ruleId: "tech.sitemap-missing",
        category: "Technical SEO",
        title: "No XML sitemap found",
        severity: "MEDIUM",
        evidenceStatus: "CONFIRMED",
        affectedUrls: input.sitemaps.checked.map((c) => c.url),
        observedFacts: `Checked ${input.sitemaps.checked.map((c) => `${c.url} (${c.status ?? "no response"})`).join(", ")}${input.robots.sitemaps.length ? "" : "; robots.txt declares no sitemap"}.`,
        businessImpact: "A sitemap helps search engines find every important page, especially new or weakly linked ones.",
        recommendation: "Generate an XML sitemap of indexable pages, reference it in robots.txt and submit it in Search Console.",
        complexity: "LOW",
        confidence: "MEDIUM",
        verificationMethod: "Fetch the sitemap URL and submit it in Google Search Console.",
        evidence: input.sitemaps.checked.map((c) => ({ kind: "SITEMAP" as const, url: c.url, measurement: { status: c.status, kind: c.kind }, method: "HTTP GET" })),
      },
    ];
  }
  const out: FindingDraft[] = [];
  // Sitemap URLs that we crawled and that are not 200 / not canonical.
  const sitemapSet = new Set(input.sitemaps.urls);
  const bad = input.pages.filter((p) => sitemapSet.has(p.url) && ((p.status ?? 0) >= 300 || p.redirectChain.length > 1));
  if (bad.length) {
    out.push({
      ruleId: "tech.sitemap-non-200",
      category: "Technical SEO",
      title: "Sitemap lists URLs that redirect or return errors",
      severity: bad.some((b) => (b.status ?? 0) >= 400) ? "MEDIUM" : "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: bad.map((b) => b.url),
      observedFacts: `${plural(bad.length, "sitemap URL")} we crawled did not return a direct 200: ${bad
        .slice(0, 5)
        .map((b) => `${b.url} → ${b.redirectChain.map((h) => h.status).join(" → ") || b.error}`)
        .join("; ")}.`,
      businessImpact: "Sitemaps should only list final, indexable URLs; redirects and errors waste crawl attention and send mixed signals.",
      recommendation: "Update the sitemap to list only the final 200-status canonical URLs.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl sitemap URLs and confirm each returns 200 without redirect.",
      evidence: bad.slice(0, 10).map((b) => ({ kind: "HTTP_STATUS" as const, url: b.url, measurement: { chain: b.redirectChain }, method: "HTTP GET of sitemap URL" })),
    });
  }
  return out;
};

const httpsRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const home = new URL(input.homepageUrl);
  if (home.protocol === "http:") {
    out.push({
      ruleId: "tech.no-https",
      category: "Technical SEO",
      title: "Website is served over insecure HTTP",
      severity: "HIGH",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [input.homepageUrl],
      observedFacts: `The homepage resolved to ${input.homepageUrl} without redirecting to HTTPS.`,
      businessImpact: "Browsers label HTTP pages as \"Not secure\", which reduces trust and enquiries; HTTPS is also a lightweight ranking signal.",
      recommendation: "Install a TLS certificate, redirect all HTTP URLs to HTTPS with 301s, and update internal links and canonicals.",
      complexity: "MEDIUM",
      confidence: "HIGH",
      verificationMethod: "Load http:// and https:// versions and confirm a single 301 to HTTPS.",
      evidence: [{ kind: "HTTP_STATUS", url: input.homepageUrl, method: "Followed redirects from the submitted URL" }],
    });
  } else if (input.httpToHttps.checked && input.httpToHttps.redirectsToHttps === false) {
    out.push({
      ruleId: "tech.http-not-redirected",
      category: "Technical SEO",
      title: "HTTP version does not redirect to HTTPS",
      severity: "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [`http://${home.host}/`],
      observedFacts: `http://${home.host}/ ended at ${input.httpToHttps.finalUrl} instead of the HTTPS homepage.`,
      businessImpact: "Two versions of the site can be reached, which splits signals and can show visitors an insecure page.",
      recommendation: "Add a site-wide 301 redirect from HTTP to HTTPS.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Request http:// homepage and confirm a 301 to https://.",
      evidence: [{ kind: "HTTP_STATUS", url: `http://${home.host}/`, measurement: { finalUrl: input.httpToHttps.finalUrl }, method: "HTTP GET following redirects" }],
    });
  }
  const mixed = okPages(input).filter((p) => p.page.mixedContent.length > 0);
  if (mixed.length) {
    out.push({
      ruleId: "tech.mixed-content",
      category: "Technical SEO",
      title: "HTTPS pages load insecure HTTP resources",
      severity: "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: mixed.map((p) => p.finalUrl),
      observedFacts: `${plural(mixed.length, "page")} reference http:// images, scripts or styles, e.g. ${mixed[0].page.mixedContent.slice(0, 3).join(", ")}.`,
      businessImpact: "Browsers block or warn about mixed content, which can break page elements and show security warnings.",
      recommendation: "Change these resource URLs to https:// (or protocol-relative) and confirm they load.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Open the pages with browser dev tools and confirm no mixed-content warnings.",
      evidence: mixed.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: p.page.mixedContent.slice(0, 5).join("\n"), method: "Parsed src/href attributes in HTML" })),
    });
  }
  return out;
};

const statusRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const homepage = input.pages[0];
  if (homepage && (homepage.status === null || homepage.status >= 400)) {
    out.push({
      ruleId: "tech.homepage-error",
      category: "Technical SEO",
      title: "Homepage does not load successfully",
      severity: "CRITICAL",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [homepage.url],
      observedFacts: `The homepage returned ${homepage.status ? `HTTP ${homepage.status}` : `no response (${homepage.error})`} when crawled on ${input.collectedAt.toISOString()}.`,
      businessImpact: "Visitors and search engines cannot reach the main entry point of the site.",
      recommendation: "Investigate hosting/server configuration immediately and confirm the homepage returns HTTP 200.",
      complexity: "MEDIUM",
      confidence: "MEDIUM",
      verificationMethod: "Re-check from several locations; temporary outages should be confirmed with uptime monitoring.",
      requiresHumanReview: true,
      evidence: [{ kind: "HTTP_STATUS", url: homepage.url, measurement: { status: homepage.status, error: homepage.error }, method: "HTTP GET" }],
    });
  }
  const broken = input.pages.filter((p) => p !== homepage && p.status !== null && p.status >= 400);
  if (broken.length) {
    const fromLinks = broken.filter((b) => b.discoveredVia === "link");
    out.push({
      ruleId: "tech.broken-internal-urls",
      category: "Technical SEO",
      title: fromLinks.length ? "Broken internal links (4xx/5xx pages)" : "Sitemap URLs return errors",
      severity: broken.length >= 3 || broken.some((b) => (b.status ?? 0) >= 500) ? "HIGH" : "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: broken.map((b) => b.url),
      observedFacts: broken
        .slice(0, 8)
        .map((b) => `${b.url} returned HTTP ${b.status}${b.linkedFrom ? ` (linked from ${b.linkedFrom})` : " (listed in sitemap)"}`)
        .join("; "),
      businessImpact: "Visitors who click these links hit an error page, and link value is wasted on URLs that do not exist.",
      recommendation: "Fix or remove the links, or 301-redirect the old URLs to the most relevant live page.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl the linking pages and confirm no links point to 4xx/5xx URLs.",
      evidence: broken.slice(0, 15).map((b) => ({ kind: "HTTP_STATUS" as const, url: b.url, measurement: { status: b.status, linkedFrom: b.linkedFrom }, method: "HTTP GET" })),
    });
  }
  const chains = input.pages.filter((p) => p.redirectChain.length > 2);
  if (chains.length) {
    out.push({
      ruleId: "tech.redirect-chains",
      category: "Technical SEO",
      title: "Redirect chains on internal URLs",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: chains.map((c) => c.url),
      observedFacts: chains
        .slice(0, 5)
        .map((c) => c.redirectChain.map((h) => `${h.url} (${h.status})`).join(" → "))
        .join("; "),
      businessImpact: "Each extra hop slows the page down for visitors and crawlers.",
      recommendation: "Point links and redirects straight at the final URL.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Request the URLs and confirm a single redirect hop at most.",
      evidence: chains.slice(0, 10).map((c) => ({ kind: "HTTP_STATUS" as const, url: c.url, measurement: { chain: c.redirectChain }, method: "HTTP GET with manual redirects" })),
    });
  }
  const linkedRedirects = input.pages.filter((p) => p.discoveredVia === "link" && p.redirectChain.length > 1 && (p.status ?? 0) < 400);
  if (linkedRedirects.length >= 3) {
    out.push({
      ruleId: "tech.internal-links-to-redirects",
      category: "Technical SEO",
      title: "Internal links point to redirecting URLs",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: linkedRedirects.map((p) => p.url),
      observedFacts: `${plural(linkedRedirects.length, "internally linked URL")} redirect elsewhere, e.g. ${linkedRedirects
        .slice(0, 3)
        .map((p) => `${p.url} → ${p.finalUrl}`)
        .join("; ")}.`,
      businessImpact: "Minor: adds latency and dilutes clean internal linking.",
      recommendation: "Update internal links to use the final destination URLs.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl and confirm internal links resolve without redirects.",
      evidence: linkedRedirects.slice(0, 10).map((p) => ({ kind: "HTTP_STATUS" as const, url: p.url, measurement: { finalUrl: p.finalUrl, linkedFrom: p.linkedFrom }, method: "HTTP GET" })),
    });
  }
  return out;
};

const indexabilityRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const noindex = okPages(input).filter((p) => /noindex/.test(p.page.robotsMeta ?? "") || /noindex/i.test(p.xRobotsTag ?? ""));
  const importantNoindex = noindex.filter((p) => IMPORTANT_TYPES.has(p.pageType ?? ""));
  if (noindex.length) {
    const homeBlocked = noindex.some((p) => p.pageType === "HOMEPAGE");
    out.push({
      ruleId: "tech.noindex",
      category: "Technical SEO",
      title: homeBlocked ? "Homepage carries a noindex directive" : importantNoindex.length ? "Important pages carry a noindex directive" : "Pages carry a noindex directive",
      severity: homeBlocked ? "CRITICAL" : importantNoindex.length ? "HIGH" : "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: noindex.map((p) => p.finalUrl),
      observedFacts: noindex
        .slice(0, 6)
        .map((p) => `${p.finalUrl}: ${p.page.robotsMeta ? `meta robots="${p.page.robotsMeta}"` : `X-Robots-Tag: ${p.xRobotsTag}`}`)
        .join("; "),
      businessImpact: "A noindex directive tells search engines not to show the page in results. The directive itself is confirmed; whether Google has already dropped the page needs Search Console data.",
      recommendation: importantNoindex.length
        ? "Remove noindex from pages that should appear in search, unless they are intentionally hidden."
        : "Confirm these pages are intentionally excluded from search.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Use Search Console URL Inspection on each affected page after the change.",
      requiresHumanReview: !importantNoindex.length,
      evidence: noindex.slice(0, 10).map((p) => ({
        kind: p.page.robotsMeta?.includes("noindex") ? ("HTML" as const) : ("HTTP_HEADER" as const),
        url: p.finalUrl,
        excerpt: p.page.robotsMeta ? `<meta name="robots" content="${p.page.robotsMeta}">` : `X-Robots-Tag: ${p.xRobotsTag}`,
        method: "Parsed meta robots / response headers",
      })),
    });
  }

  // Canonicals.
  const pages = okPages(input).filter((p) => !noindex.includes(p));
  const missing = pages.filter((p) => !p.page.canonical);
  const pointsElsewhere = pages.filter((p) => p.page.canonical && p.page.canonical.replace(/\/$/, "") !== p.finalUrl.replace(/\/$/, ""));
  const crossDomain = pointsElsewhere.filter((p) => new URL(p.page.canonical!).hostname.replace(/^www\./, "") !== new URL(p.finalUrl).hostname.replace(/^www\./, ""));
  const multiple = pages.filter((p) => p.page.canonicalCount > 1);
  if (crossDomain.length || multiple.length) {
    out.push({
      ruleId: "tech.canonical-conflict",
      category: "Technical SEO",
      title: crossDomain.length ? "Canonical tags point to another domain" : "Pages declare more than one canonical",
      severity: "HIGH",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [...crossDomain, ...multiple].map((p) => p.finalUrl),
      observedFacts: [
        ...crossDomain.slice(0, 4).map((p) => `${p.finalUrl} → canonical ${p.page.canonical}`),
        ...multiple.slice(0, 4).map((p) => `${p.finalUrl} has ${p.page.canonicalCount} canonical tags`),
      ].join("; "),
      businessImpact: "Search engines may credit another domain's URL, or ignore conflicting canonicals entirely.",
      recommendation: "Use a single self-referencing canonical on each indexable page unless consolidation to another URL is intended.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "View source of each page and confirm exactly one correct canonical; check Google-selected canonical in Search Console.",
      evidence: [...crossDomain, ...multiple].slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: `canonical: ${p.page.canonical} (count ${p.page.canonicalCount})`, method: "Parsed <link rel=canonical>" })),
    });
  }
  const sameSiteElsewhere = pointsElsewhere.filter((p) => !crossDomain.includes(p));
  if (sameSiteElsewhere.length) {
    const targets = new Map(input.pages.map((p) => [p.url.replace(/\/$/, ""), p]));
    const brokenTargets = sameSiteElsewhere.filter((p) => {
      const t = targets.get(p.page.canonical!.replace(/\/$/, ""));
      return t && ((t.status ?? 0) >= 300 || t.redirectChain.length > 1);
    });
    out.push({
      ruleId: "tech.canonical-elsewhere",
      category: "Technical SEO",
      title: brokenTargets.length ? "Canonical tags point to redirecting or broken URLs" : "Pages canonicalise to a different URL",
      severity: brokenTargets.length ? "MEDIUM" : "LOW",
      evidenceStatus: brokenTargets.length ? "CONFIRMED" : "POTENTIAL",
      affectedUrls: sameSiteElsewhere.map((p) => p.finalUrl),
      observedFacts: sameSiteElsewhere
        .slice(0, 6)
        .map((p) => `${p.finalUrl} → ${p.page.canonical}`)
        .join("; "),
      businessImpact: "These pages ask search engines to index a different URL instead. That is correct for true duplicates but harmful if the page should rank on its own.",
      recommendation: "Confirm each canonical target is intended; point canonicals at final 200-status URLs.",
      complexity: "LOW",
      confidence: brokenTargets.length ? "HIGH" : "MEDIUM",
      verificationMethod: "Review each pair manually and compare with Search Console's Google-selected canonical.",
      requiresHumanReview: !brokenTargets.length,
      evidence: sameSiteElsewhere.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: `<link rel="canonical" href="${p.page.canonical}">`, method: "Parsed <link rel=canonical>" })),
    });
  }
  if (missing.length && pct(missing.length, pages.length) >= 30) {
    out.push({
      ruleId: "tech.canonical-missing",
      category: "Technical SEO",
      title: "Canonical tags missing on many pages",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: missing.map((p) => p.finalUrl),
      observedFacts: `${missing.length} of ${pages.length} analysed indexable pages have no <link rel="canonical">.`,
      businessImpact: "Without canonicals, URL variations (tracking parameters, trailing slashes, http/https) can be treated as duplicates.",
      recommendation: "Add a self-referencing canonical tag to every indexable page (most CMSs and SEO plugins can do this automatically).",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl and confirm each page has one self-referencing canonical.",
      evidence: [{ kind: "CRAWL_SCOPE", measurement: { missing: missing.length, analysed: pages.length }, method: scopeNote(input) }],
    });
  }
  return out;
};

const mobileAndLangRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input);
  const noViewport = pages.filter((p) => !p.page.viewport);
  if (noViewport.length) {
    const homeMissing = noViewport.some((p) => p.pageType === "HOMEPAGE");
    out.push({
      ruleId: "tech.viewport-missing",
      category: "Technical SEO",
      title: "Pages are missing the mobile viewport tag",
      severity: homeMissing || pct(noViewport.length, pages.length) > 50 ? "HIGH" : "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: noViewport.map((p) => p.finalUrl),
      observedFacts: `${noViewport.length} of ${pages.length} pages have no <meta name="viewport">.`,
      businessImpact: "Without a viewport tag, mobile browsers render the desktop layout zoomed out, which hurts mobile usability. Google indexes the mobile version of sites.",
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to every page template and check the layout on a phone.',
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Open the pages on a mobile device or Chrome device emulation.",
      evidence: noViewport.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: "No <meta name=\"viewport\"> in <head>", method: "Parsed HTML head" })),
    });
  }
  const noLang = pages.filter((p) => !p.page.lang);
  if (noLang.length && pct(noLang.length, pages.length) >= 50) {
    out.push({
      ruleId: "tech.lang-missing",
      category: "Technical SEO",
      title: "HTML language attribute missing",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: noLang.map((p) => p.finalUrl),
      observedFacts: `${noLang.length} of ${pages.length} pages have no lang attribute on <html>.`,
      businessImpact: "Minor: helps browsers, screen readers and search engines understand the page language.",
      recommendation: 'Set <html lang="…"> to the page language in the site template.',
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "View source and confirm the lang attribute.",
      evidence: [{ kind: "CRAWL_SCOPE", measurement: { missing: noLang.length, analysed: pages.length }, method: "Parsed <html> element" }],
    });
  }
  return out;
};

const structuredDataRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input);
  const errors = pages.filter((p) => p.page.structuredData.jsonLdErrors > 0);
  if (errors.length) {
    out.push({
      ruleId: "tech.jsonld-invalid",
      category: "Technical SEO",
      title: "Structured data blocks contain invalid JSON",
      severity: "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: errors.map((p) => p.finalUrl),
      observedFacts: `${plural(errors.length, "page")} contain JSON-LD that cannot be parsed.`,
      businessImpact: "Search engines ignore structured data they cannot parse, so any rich-result eligibility from it is lost.",
      recommendation: "Fix the JSON syntax and validate with Google's Rich Results Test.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Run the pages through the Rich Results Test / Schema Markup Validator.",
      evidence: errors.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, measurement: { invalidBlocks: p.page.structuredData.jsonLdErrors }, method: "JSON.parse of <script type=application/ld+json>" })),
    });
  }
  const allTypes = new Set(pages.flatMap((p) => p.page.structuredData.types.map((t) => t.toLowerCase())));
  const hasBusiness = [...allTypes].some((t) => /organization|localbusiness|business|store|clinic|dentist|restaurant|agency|service|contractor|plumber|electrician|attorney/.test(t));
  if (!hasBusiness && pages.length) {
    out.push({
      ruleId: "tech.business-schema-missing",
      category: "Technical SEO",
      title: "No Organization / LocalBusiness structured data found",
      severity: "OPPORTUNITY",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [input.homepageUrl],
      observedFacts: `None of the ${pages.length} analysed pages declare Organization or LocalBusiness schema${allTypes.size ? ` (types found: ${[...allTypes].slice(0, 8).join(", ")})` : " (no structured data at all)"}.`,
      businessImpact: "Business schema helps search engines connect the website with the business's name, logo, contact details and locations.",
      recommendation: "Add Organization or the most specific LocalBusiness type with name, URL, logo, telephone, address and sameAs links — using only accurate, published details.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Validate with the Schema Markup Validator after implementation.",
      evidence: [{ kind: "CRAWL_SCOPE", measurement: { typesFound: [...allTypes] }, method: `Parsed JSON-LD and microdata on ${scopeNote(input)}` }],
    });
  }
  return out;
};

const performanceRules: Rule = (input) => {
  const slow = okPages(input).filter((p) => (p.responseTimeMs ?? 0) > 1800);
  if (slow.length < 2) return [];
  return [
    {
      ruleId: "tech.slow-server-response",
      category: "Technical SEO",
      title: "Slow server responses observed during the crawl",
      severity: "NEEDS_VERIFICATION",
      evidenceStatus: "POTENTIAL",
      affectedUrls: slow.map((p) => p.finalUrl),
      observedFacts: `${slow.length} pages took more than 1.8 s to start responding (max ${Math.max(...slow.map((p) => p.responseTimeMs ?? 0))} ms). Measured once from the audit server, not from real users.`,
      businessImpact: "If confirmed, slow server response delays every page load and can hurt Core Web Vitals.",
      recommendation: "Confirm with PageSpeed Insights / CrUX field data before acting; if confirmed, review hosting, caching and database performance.",
      complexity: "MEDIUM",
      confidence: "LOW",
      verificationMethod: "PageSpeed Insights (field data) or repeated TTFB measurements from the target country.",
      requiresHumanReview: true,
      evidence: slow.slice(0, 10).map((p) => ({ kind: "MEASUREMENT" as const, url: p.finalUrl, measurement: { timeToHeadersMs: p.responseTimeMs, device: "server-side crawler", runs: 1 }, method: "Time to response headers from audit server" })),
    },
  ];
};

const renderingRules: Rule = (input) => {
  const rendered = input.pages.filter((p) => p.rendered && p.page && (p.rawWordCount ?? 0) < 80);
  if (!rendered.length) return [];
  return [
    {
      ruleId: "tech.js-dependent-content",
      category: "Technical SEO",
      title: "Main content only appears after JavaScript runs",
      severity: "MEDIUM",
      evidenceStatus: "POTENTIAL",
      affectedUrls: rendered.map((p) => p.finalUrl!),
      observedFacts: rendered
        .slice(0, 5)
        .map((p) => `${p.finalUrl}: ${p.rawWordCount} words in raw HTML vs ${p.page!.wordCount} after rendering`)
        .join("; "),
      businessImpact: "Google can render JavaScript, but it is slower and less reliable than server-rendered HTML; other search engines and link previews may see an empty page.",
      recommendation: "Consider server-side rendering or pre-rendering for key pages; confirm what Google sees with URL Inspection → View crawled page.",
      complexity: "HIGH",
      confidence: "MEDIUM",
      verificationMethod: "Search Console URL Inspection rendered HTML.",
      requiresHumanReview: true,
      evidence: rendered.slice(0, 5).map((p) => ({ kind: "MEASUREMENT" as const, url: p.finalUrl!, measurement: { rawWords: p.rawWordCount, renderedWords: p.page!.wordCount }, method: "Raw HTML vs headless browser render" })),
    },
  ];
};

// ───────────────────────────── On-page ─────────────────────────────

function duplicates(pages: OkPage[], value: (p: OkPage) => string | null) {
  const groups = new Map<string, OkPage[]>();
  for (const p of pages) {
    const v = value(p)?.trim().toLowerCase();
    if (!v) continue;
    groups.set(v, [...(groups.get(v) ?? []), p]);
  }
  return [...groups.entries()].filter(([, g]) => g.length > 1);
}

const titleRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input).filter((p) => !/noindex/.test(p.page.robotsMeta ?? ""));
  const missing = pages.filter((p) => !p.page.title);
  if (missing.length) {
    out.push({
      ruleId: "onpage.title-missing",
      category: "On-Page SEO",
      title: "Pages without a title tag",
      severity: missing.some((p) => IMPORTANT_TYPES.has(p.pageType ?? "")) ? "HIGH" : "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: missing.map((p) => p.finalUrl),
      observedFacts: `${plural(missing.length, "page")} have no <title> or an empty one: ${list(missing.map((p) => p.finalUrl))}.`,
      businessImpact: "The title is the main headline shown in search results; without it search engines generate one, usually poorly.",
      recommendation: "Write a unique, descriptive title for each page that states the service/topic and, where relevant, the location and brand.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "View source and confirm a non-empty <title>.",
      evidence: missing.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: "<title> missing or empty", method: "Parsed HTML head" })),
    });
  }
  const dupes = duplicates(pages, (p) => p.page.title);
  if (dupes.length) {
    const affected = dupes.flatMap(([, g]) => g);
    out.push({
      ruleId: "onpage.title-duplicate",
      category: "On-Page SEO",
      title: "Duplicate title tags",
      severity: affected.some((p) => IMPORTANT_TYPES.has(p.pageType ?? "")) ? "MEDIUM" : "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: affected.map((p) => p.finalUrl),
      observedFacts: dupes
        .slice(0, 5)
        .map(([, g]) => `"${g[0].page.title}" is used on ${g.length} pages (${list(g.map((p) => p.finalUrl), 3)})`)
        .join("; "),
      businessImpact: "Identical titles make it harder for search engines and searchers to tell pages apart, and pages may compete with each other.",
      recommendation: "Give each page a unique title that reflects its specific topic or service.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl and compare titles.",
      evidence: dupes.slice(0, 10).map(([, g]) => ({ kind: "HTML" as const, url: g[0].finalUrl, excerpt: `<title>${g[0].page.title}</title>`, measurement: { urls: g.map((p) => p.finalUrl) }, method: "Compared collected title values" })),
    });
  }
  const long = pages.filter((p) => (p.page.title?.length ?? 0) > 65);
  if (long.length && pct(long.length, pages.length) >= 25) {
    out.push({
      ruleId: "onpage.title-long",
      category: "On-Page SEO",
      title: "Long titles likely to be truncated in search results",
      severity: "LOW",
      evidenceStatus: "POTENTIAL",
      affectedUrls: long.map((p) => p.finalUrl),
      observedFacts: `${long.length} titles exceed 65 characters, e.g. "${long[0].page.title}" (${long[0].page.title!.length} chars).`,
      businessImpact: "Search results show roughly the first 50–65 characters (it depends on pixel width), so the end of these titles may be cut off.",
      recommendation: "Put the most important words first and keep titles concise.",
      complexity: "LOW",
      confidence: "MEDIUM",
      verificationMethod: "Preview titles in a SERP snippet tool.",
      evidence: long.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: p.page.title!, measurement: { length: p.page.title!.length }, method: "Measured title length" })),
    });
  }
  return out;
};

const metaDescriptionRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input).filter((p) => !/noindex/.test(p.page.robotsMeta ?? ""));
  const missing = pages.filter((p) => !p.page.metaDescription);
  if (missing.length && pct(missing.length, pages.length) >= 20) {
    out.push({
      ruleId: "onpage.meta-description-missing",
      category: "On-Page SEO",
      title: "Missing meta descriptions",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: missing.map((p) => p.finalUrl),
      observedFacts: `${missing.length} of ${pages.length} indexable pages have no meta description.`,
      businessImpact: "Meta descriptions do not affect rankings directly, but a clear description can improve how many searchers click the result.",
      recommendation: "Write a specific description for key pages that summarises the offer and includes a reason to click.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "View source and confirm meta description content.",
      evidence: [{ kind: "CRAWL_SCOPE", measurement: { missing: missing.length, analysed: pages.length, examples: missing.slice(0, 5).map((p) => p.finalUrl) }, method: "Parsed <meta name=description>" }],
    });
  }
  const dupes = duplicates(pages, (p) => p.page.metaDescription);
  if (dupes.length) {
    const affected = dupes.flatMap(([, g]) => g);
    out.push({
      ruleId: "onpage.meta-description-duplicate",
      category: "On-Page SEO",
      title: "Duplicate meta descriptions",
      severity: "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: affected.map((p) => p.finalUrl),
      observedFacts: dupes
        .slice(0, 3)
        .map(([, g]) => `"${g[0].page.metaDescription!.slice(0, 90)}…" on ${g.length} pages`)
        .join("; "),
      businessImpact: "Repeated descriptions are less useful to searchers and are often rewritten by Google.",
      recommendation: "Write unique descriptions for important pages.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl and compare descriptions.",
      evidence: dupes.slice(0, 10).map(([, g]) => ({ kind: "HTML" as const, url: g[0].finalUrl, excerpt: g[0].page.metaDescription!, measurement: { urls: g.map((p) => p.finalUrl) }, method: "Compared collected meta descriptions" })),
    });
  }
  return out;
};

const headingRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input);
  const noH1 = pages.filter((p) => p.page.h1.filter(Boolean).length === 0);
  if (noH1.length) {
    out.push({
      ruleId: "onpage.h1-missing",
      category: "On-Page SEO",
      title: "Pages without an H1 heading",
      severity: noH1.some((p) => IMPORTANT_TYPES.has(p.pageType ?? "")) ? "MEDIUM" : "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: noH1.map((p) => p.finalUrl),
      observedFacts: `${plural(noH1.length, "page")} have no non-empty <h1>: ${list(noH1.map((p) => p.finalUrl))}.`,
      businessImpact: "The main heading tells visitors and search engines what the page is about; pages without one are less clear.",
      recommendation: "Add one descriptive H1 per page that matches the page's main topic.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "View source / inspect the page heading structure.",
      evidence: noH1.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: `Headings found: ${p.page.headings.slice(0, 5).map((h) => `h${h.level} "${h.text}"`).join(", ") || "none"}`, method: "Parsed heading elements" })),
    });
  }
  const multiH1 = pages.filter((p) => p.page.h1.length > 1);
  if (multiH1.length && pct(multiH1.length, pages.length) >= 30) {
    out.push({
      ruleId: "onpage.h1-multiple",
      category: "On-Page SEO",
      title: "Multiple H1 headings on many pages",
      severity: "LOW",
      evidenceStatus: "POTENTIAL",
      affectedUrls: multiH1.map((p) => p.finalUrl),
      observedFacts: `${multiH1.length} pages use more than one H1, e.g. ${multiH1[0].finalUrl}: ${multiH1[0].page.h1.map((h) => `"${h}"`).join(", ")}.`,
      businessImpact: "Not an error, but a single clear H1 usually makes the page's main topic easier to understand.",
      recommendation: "Review templates; keep one H1 for the main topic and use H2/H3 for sections.",
      complexity: "LOW",
      confidence: "MEDIUM",
      verificationMethod: "Review heading outline of the templates.",
      requiresHumanReview: true,
      evidence: multiH1.slice(0, 10).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: p.page.h1.join(" | "), method: "Parsed <h1> elements" })),
    });
  }
  return out;
};

const imageRules: Rule = (input) => {
  const pages = okPages(input);
  const all = pages.flatMap((p) => p.page.images.map((i) => ({ ...i, pageUrl: p.finalUrl })));
  // alt="" is valid for decorative images, so only a missing attribute counts.
  const missingAlt = all.filter((i) => i.alt === null);
  const unique = new Map(missingAlt.map((i) => [i.src, i]));
  if (unique.size < 3 || pct(missingAlt.length, all.length) < 10) return [];
  return [
    {
      ruleId: "onpage.image-alt-missing",
      category: "On-Page SEO",
      title: "Images without alt attributes",
      severity: pct(missingAlt.length, all.length) > 50 ? "MEDIUM" : "LOW",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [...new Set(missingAlt.map((i) => i.pageUrl))],
      observedFacts: `${unique.size} unique images (${missingAlt.length} of ${all.length} image tags) have no alt attribute.`,
      businessImpact: "Alt text describes images for screen-reader users and for image search; missing alt attributes are an accessibility gap.",
      recommendation: 'Add short, accurate alt text to meaningful images (and alt="" to purely decorative ones).',
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Re-crawl and count images without alt attributes.",
      evidence: [...unique.values()].slice(0, 10).map((i) => ({ kind: "HTML" as const, url: i.pageUrl, excerpt: `<img src="${i.src}"> (no alt)`, method: "Parsed <img> elements" })),
    },
  ];
};

// ───────────────────────────── Content ─────────────────────────────

const contentRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input).filter((p) => !/noindex/.test(p.page.robotsMeta ?? ""));
  const thin = pages.filter((p) => ["SERVICE", "LOCATION", "PRODUCT"].includes(p.pageType ?? "") && p.page.wordCount < 250);
  if (thin.length) {
    out.push({
      ruleId: "content.thin-commercial-pages",
      category: "Content",
      title: "Service or location pages with very little content",
      severity: "MEDIUM",
      evidenceStatus: "POTENTIAL",
      affectedUrls: thin.map((p) => p.finalUrl),
      observedFacts: thin
        .slice(0, 6)
        .map((p) => `${p.finalUrl} (${p.page.wordCount} words)`)
        .join("; "),
      businessImpact: "Short commercial pages often fail to answer what customers need to know (process, pricing guidance, proof, FAQs), which affects both rankings and conversions.",
      recommendation: "Review these pages and add genuinely useful, specific information. Word count alone is not the goal.",
      complexity: "MEDIUM",
      confidence: "MEDIUM",
      verificationMethod: "Manual content review against competing pages for the same searches.",
      requiresHumanReview: true,
      evidence: thin.slice(0, 10).map((p) => ({ kind: "MEASUREMENT" as const, url: p.finalUrl, measurement: { wordCount: p.page.wordCount, pageType: p.pageType }, excerpt: p.page.textExcerpt.slice(0, 300), method: "Visible text word count" })),
    });
  }

  // Near-duplicate content (shingle overlap).
  const comparable = pages.filter((p) => p.page.wordCount >= 120 && p.page.shingles.length >= 20).slice(0, 80);
  const pairs: { a: OkPage; b: OkPage; sim: number }[] = [];
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const sim = jaccard(comparable[i].page.shingles, comparable[j].page.shingles);
      if (sim >= 0.7) pairs.push({ a: comparable[i], b: comparable[j], sim });
    }
  }
  if (pairs.length) {
    pairs.sort((x, y) => y.sim - x.sim);
    const locationPairs = pairs.filter((p) => p.a.pageType === "LOCATION" || p.b.pageType === "LOCATION");
    out.push({
      ruleId: "content.near-duplicates",
      category: "Content",
      title: locationPairs.length ? "Location pages with largely repeated text" : "Pages with largely duplicated text",
      severity: "MEDIUM",
      evidenceStatus: "POTENTIAL",
      affectedUrls: [...new Set(pairs.flatMap((p) => [p.a.finalUrl, p.b.finalUrl]))],
      observedFacts: pairs
        .slice(0, 5)
        .map((p) => `${p.a.finalUrl} and ${p.b.finalUrl} share ~${Math.round(p.sim * 100)}% of their text`)
        .join("; "),
      businessImpact: "When pages are mostly the same text, search engines tend to show only one of them and the others add little value.",
      recommendation: "Review each page's purpose. Make pages that serve different searches genuinely distinct (local details, examples, FAQs), and consider consolidating true duplicates. Do not merge or delete without checking traffic and links first.",
      complexity: "MEDIUM",
      confidence: "MEDIUM",
      verificationMethod: "Manual comparison; check Search Console performance for each URL before consolidating.",
      requiresHumanReview: true,
      evidence: pairs.slice(0, 10).map((p) => ({ kind: "MEASUREMENT" as const, url: p.a.finalUrl, measurement: { comparedWith: p.b.finalUrl, textOverlap: Math.round(p.sim * 100) / 100 }, method: "5-word shingle Jaccard similarity of visible text" })),
    });
  }
  const sameTitleIntent = duplicates(pages.filter((p) => ["SERVICE", "LOCATION"].includes(p.pageType ?? "")), (p) => p.page.h1[0] ?? null);
  if (sameTitleIntent.length) {
    const affected = sameTitleIntent.flatMap(([, g]) => g);
    out.push({
      ruleId: "content.competing-pages",
      category: "Content",
      title: "Several pages target the same heading",
      severity: "LOW",
      evidenceStatus: "POTENTIAL",
      affectedUrls: affected.map((p) => p.finalUrl),
      observedFacts: sameTitleIntent
        .slice(0, 4)
        .map(([, g]) => `H1 "${g[0].page.h1[0]}" on ${list(g.map((p) => p.finalUrl), 3)}`)
        .join("; "),
      businessImpact: "Pages aimed at the same search may compete with each other. Search Console query data is needed to confirm.",
      recommendation: "Decide which page should rank for the topic and differentiate or consolidate the others after checking their data.",
      complexity: "MEDIUM",
      confidence: "LOW",
      verificationMethod: "Search Console: check whether multiple URLs receive impressions for the same queries.",
      requiresAccess: true,
      requiresHumanReview: true,
      evidence: sameTitleIntent.slice(0, 10).map(([, g]) => ({ kind: "HTML" as const, url: g[0].finalUrl, excerpt: g[0].page.h1[0], measurement: { urls: g.map((p) => p.finalUrl) }, method: "Compared H1 headings" })),
    });
  }
  return out;
};

// ───────────────────────────── Local & conversion ─────────────────────────────

const conversionRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const pages = okPages(input);
  const homepage = pages.find((p) => p.pageType === "HOMEPAGE");
  const anyContactLink = pages.some((p) => p.page.telLinks.length || p.page.mailtoLinks.length || p.page.whatsappLinks.length);
  const contactForm = pages.some((p) => p.page.forms.some((f) => f.hasTextarea && f.hasEmailField && !f.hasPassword));
  const contactPage = pages.some((p) => p.pageType === "CONTACT");

  if (homepage && !homepage.page.telLinks.length && !homepage.page.whatsappLinks.length) {
    out.push({
      ruleId: "cro.no-click-to-call-home",
      category: "Conversion",
      title: "No click-to-call or WhatsApp link on the homepage",
      severity: anyContactLink ? "LOW" : "MEDIUM",
      evidenceStatus: "CONFIRMED",
      affectedUrls: [homepage.finalUrl],
      observedFacts: `The homepage HTML contains no tel: or WhatsApp links${anyContactLink ? ", although other pages do" : ", and none of the other analysed pages do either"}. A number may still be shown as plain text or an image.`,
      businessImpact: "Mobile visitors are more likely to call or message when the number is one tap away.",
      recommendation: "Make the phone number a tel: link and consider a WhatsApp click-to-chat button in the header.",
      complexity: "LOW",
      confidence: "HIGH",
      verificationMethod: "Tap the number on a phone and confirm it opens the dialler.",
      evidence: [{ kind: "HTML", url: homepage.finalUrl, excerpt: "No <a href=\"tel:…\"> or wa.me link found", method: "Parsed homepage links" }],
    });
  }
  if (!contactForm && !contactPage) {
    out.push({
      ruleId: "cro.no-contact-path",
      category: "Conversion",
      title: "No contact page or enquiry form found",
      severity: "MEDIUM",
      evidenceStatus: "POTENTIAL",
      affectedUrls: [input.homepageUrl],
      observedFacts: `No page was identified as a contact page and no form with email + message fields was found across ${scopeNote(input)}.`,
      businessImpact: "Visitors who prefer writing over calling have no obvious way to enquire.",
      recommendation: "Add a clear contact page with a short form, phone, email and opening hours, linked from the main navigation.",
      complexity: "LOW",
      confidence: input.limitReached ? "LOW" : "MEDIUM",
      verificationMethod: "Manually browse the site; forms loaded by third-party widgets may not be visible to the crawler.",
      requiresHumanReview: true,
      evidence: [{ kind: "CRAWL_SCOPE", measurement: { pagesAnalysed: pages.length, limitReached: input.limitReached }, method: "Searched all analysed pages for contact forms and contact pages" }],
    });
  }
  return out;
};

const localRules: Rule = (input) => {
  const out: FindingDraft[] = [];
  const city = input.context.targetCity?.trim();
  if (city) {
    const pages = okPages(input);
    const re = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const mentions = pages.filter((p) => re.test(p.page.text));
    const inTitles = pages.filter((p) => re.test(`${p.page.title} ${p.page.h1.join(" ")}`));
    if (mentions.length === 0) {
      out.push({
        ruleId: "local.target-city-absent",
        category: "Local SEO",
        title: `The target area "${city}" is not mentioned on the site`,
        severity: "HIGH",
        evidenceStatus: "CONFIRMED",
        affectedUrls: [input.homepageUrl],
        observedFacts: `"${city}" does not appear in the visible text of any of the ${pages.length} analysed pages.`,
        businessImpact: "If the business wants customers in this area, the website gives search engines and visitors no local relevance signal for it.",
        recommendation: `Mention the service area naturally where it is true (homepage, contact page, relevant service pages), and consider a useful page for ${city} if the business genuinely serves it.`,
        complexity: "MEDIUM",
        confidence: input.limitReached ? "MEDIUM" : "HIGH",
        verificationMethod: "Re-crawl and search page text for the area name.",
        evidence: [{ kind: "CRAWL_SCOPE", measurement: { searchedFor: city, pagesAnalysed: pages.length }, method: "Case-insensitive search of visible page text" }],
      });
    } else if (inTitles.length === 0) {
      out.push({
        ruleId: "local.target-city-not-in-titles",
        category: "Local SEO",
        title: `"${city}" appears in text but not in any title or H1`,
        severity: "OPPORTUNITY",
        evidenceStatus: "CONFIRMED",
        affectedUrls: mentions.map((p) => p.finalUrl),
        observedFacts: `"${city}" appears on ${plural(mentions.length, "page")} but in no title tag or H1.`,
        businessImpact: "Titles and headings are strong relevance signals; local searches usually include the area name.",
        recommendation: `Where accurate, include "${city}" in the title/H1 of the homepage or main service page.`,
        complexity: "LOW",
        confidence: "HIGH",
        verificationMethod: "Re-crawl titles and H1s.",
        evidence: mentions.slice(0, 5).map((p) => ({ kind: "HTML" as const, url: p.finalUrl, excerpt: `title: ${p.page.title ?? "—"} | h1: ${p.page.h1[0] ?? "—"}`, method: "Compared title/H1 with area name" })),
      });
    }
  }
  return out;
};

// ───────────────────────────── Data access tasks ─────────────────────────────

const dataAccessRules: Rule = (input) => [
  {
    ruleId: "access.search-console",
    category: "Data & access",
    title: "Indexing, rankings and organic traffic not yet verified",
    severity: "NEEDS_VERIFICATION",
    evidenceStatus: "HYPOTHESIS",
    affectedUrls: [input.homepageUrl],
    observedFacts: "A crawl shows what is on the website, not how Google indexes or ranks it. No Search Console or ranking data has been connected for this audit.",
    businessImpact: "Index coverage, queries, clicks and positions are needed to prioritise work and to set a measurable baseline.",
    recommendation: "Request Search Console access (or an export) from the client, plus Google Analytics 4 access for conversion data.",
    complexity: "LOW",
    confidence: "HIGH",
    verificationMethod: "Import Search Console performance and indexing exports.",
    requiresAccess: true,
    evidence: [{ kind: "CRAWL_SCOPE", method: "Data sources used for this audit: public website crawl only" }],
  },
  {
    ruleId: "access.backlinks",
    category: "Data & access",
    title: "Backlink profile not assessed",
    severity: "NEEDS_VERIFICATION",
    evidenceStatus: "HYPOTHESIS",
    affectedUrls: [input.homepageUrl],
    observedFacts: "No backlink dataset was available, so no claims are made about referring domains or link quality.",
    businessImpact: "Off-page strength is often a deciding factor in competitive searches.",
    recommendation: "Import an Ahrefs or Semrush backlink export to assess referring domains and opportunities.",
    complexity: "LOW",
    confidence: "HIGH",
    verificationMethod: "CSV import from a backlink tool.",
    requiresAccess: true,
    evidence: [{ kind: "CRAWL_SCOPE", method: "No backlink data source connected" }],
  },
];

const RULES: Rule[] = [
  statusRules,
  robotsRules,
  httpsRules,
  indexabilityRules,
  sitemapRules,
  mobileAndLangRules,
  renderingRules,
  structuredDataRules,
  performanceRules,
  titleRules,
  metaDescriptionRules,
  headingRules,
  imageRules,
  contentRules,
  localRules,
  conversionRules,
  dataAccessRules,
  aiSearchRules,
];

const SEVERITY_BASE: Record<Severity, number> = { CRITICAL: 95, HIGH: 75, MEDIUM: 50, LOW: 25, OPPORTUNITY: 35, NEEDS_VERIFICATION: 20 };

/** Priority 0–100: severity first, then whether important pages are affected and how widespread it is. */
export function priorityFor(f: FindingDraft, input: AuditInput) {
  const important = new Set(input.pages.filter((p) => IMPORTANT_TYPES.has(p.pageType ?? "")).map((p) => p.finalUrl ?? p.url));
  const touchesImportant = f.affectedUrls.some((u) => important.has(u));
  const share = Math.min(f.affectedUrls.length / Math.max(okPages(input).length, 1), 1);
  const effortBonus = f.complexity === "LOW" ? 3 : f.complexity === "HIGH" ? -3 : 0;
  return Math.max(0, Math.min(100, Math.round(SEVERITY_BASE[f.severity] + (touchesImportant ? 5 : 0) + share * 5 + effortBonus)));
}

export function runRules(input: AuditInput): (FindingDraft & { priority: number })[] {
  return RULES.flatMap((rule) => rule(input))
    .map((f) => ({ ...f, priority: priorityFor(f, input) }))
    .sort((a, b) => b.priority - a.priority);
}
