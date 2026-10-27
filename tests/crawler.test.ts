import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite, type CrawlResult } from "@/lib/crawler/crawl";
import { extractPage, jaccard, shingle } from "@/lib/crawler/extract";
import { classifyPage, isOtherLanguage } from "@/lib/crawler/classify";
import { extractContacts } from "@/lib/crawler/contacts-extract";
import { BlockedUrlError } from "@/lib/crawler/network-guard";
import { safeFetch } from "@/lib/crawler/safe-fetch";
import { runRules } from "@/lib/audit/rules";
import type { AuditInput } from "@/lib/audit/types";
import { startFixtureSite } from "./fixtures/site";

let site: Awaited<ReturnType<typeof startFixtureSite>>;
let result: CrawlResult;

beforeAll(async () => {
  site = await startFixtureSite();
  result = await crawlSite(site.base, { allowPrivateNetworks: true, pageLimit: 20, delayMs: 0, maxRenders: 0 });
}, 60_000);
afterAll(() => site.close());

const byPath = (p: string) => result.pages.find((x) => new URL(x.url).pathname === p);

describe("crawler", () => {
  it("reads robots.txt and the sitemap", () => {
    expect(result.robots.found).toBe(true);
    expect(result.robots.sitemaps).toEqual([`${site.base}/sitemap.xml`]);
    expect(result.sitemaps.urls).toContain(`${site.base}/blog/orphan-post`);
  });

  it("respects robots.txt and skips admin URLs", () => {
    expect(site.requested).not.toContain("/private/area");
    expect(result.skipped.find((s) => s.url.endsWith("/private/area"))?.reason).toMatch(/robots/);
    expect(site.requested).not.toContain("/wp-admin/");
  });

  it("collects page facts, status codes and redirect chains", () => {
    expect(byPath("/")!.status).toBe(200);
    expect(byPath("/")!.pageType).toBe("HOMEPAGE");
    expect(byPath("/missing")!.status).toBe(404);
    const old = byPath("/old-page")!;
    expect(old.redirectChain.map((h) => h.status)).toEqual([301, 301, 200]);
    expect(old.finalUrl).toBe(`${site.base}/about`);
    expect(byPath("/contact")!.pageType).toBe("CONTACT");
    expect(byPath("/blog/orphan-post")!.discoveredVia).toBe("sitemap");
  });

  it("stays within the page limit", async () => {
    const small = await crawlSite(site.base, { allowPrivateNetworks: true, pageLimit: 3, delayMs: 0, maxRenders: 0 });
    expect(small.pages).toHaveLength(3);
    expect(small.limitReached).toBe(true);
  });

  it("re-validates redirects: unsafe targets are refused even in test mode", async () => {
    const srv = http.createServer((req, res) => {
      const to = req.url === "/to-ftp" ? "ftp://example.com/" : "http://user:secret@example.com/";
      res.writeHead(302, { location: to });
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    await expect(safeFetch(`${base}/to-ftp`, { allowPrivateNetworks: true })).rejects.toThrow(BlockedUrlError);
    await expect(safeFetch(`${base}/to-creds`, { allowPrivateNetworks: true })).rejects.toThrow(BlockedUrlError);
    srv.close();
  });

  it("caps response size", async () => {
    const srv = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(200_000));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const r = await safeFetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/`, { allowPrivateNetworks: true, maxBytes: 10_000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(10_000);
    srv.close();
  });
});

describe("extraction and classification", () => {
  it("ignores SVG titles and counts real ones", () => {
    const p = extractPage(`<html><head><title>Real</title></head><body><svg><title>icon</title></svg><h1>H</h1></body></html>`, "https://a.example/");
    expect(p.title).toBe("Real");
    expect(p.titleCount).toBe(1);
  });
  it("treats alt=\"\" as decorative, not missing", () => {
    const p = extractPage(`<body><img src="a.png" alt=""><img src="b.png"></body>`, "https://a.example/");
    expect(p.images.map((i) => i.alt)).toEqual(["", null]);
  });
  it("classifies by content, not only URL", () => {
    const html = `<html><head><title>Frequently asked questions</title><script type="application/ld+json">{"@type":"FAQPage"}</script></head><body><h1>FAQ</h1><h2>Do you take walk-ins?</h2></body></html>`;
    const page = extractPage(html, "https://a.example/p/123");
    expect(classifyPage("https://a.example/p/123", page, "https://a.example/").type).toBe("FAQ");
  });
  it("treats tours and priced offer pages as product pages", () => {
    const ride = extractPage(`<html><head><title>Dubai ATV Ride – Morning Desert Quad Bike</title></head><body><h1>Dubai ATV Ride</h1><p>Ride the dunes.</p></body></html>`, "https://a.example/dubai-atv-ride.html");
    expect(classifyPage("https://a.example/dubai-atv-ride.html", ride, "https://a.example/").type).toBe("PRODUCT");
    const words = Array.from({ length: 300 }, () => "dunes").join(" ");
    const offer = extractPage(`<html><head><title>Polaris RZR Dubai</title></head><body><h1>Polaris RZR</h1><p>${words} Only AED 375 per person.</p></body></html>`, "https://a.example/polaris.html");
    expect(classifyPage("https://a.example/polaris.html", offer, "https://a.example/").type).toBe("PRODUCT");
  });
  it("recognises translated pages", () => {
    expect(isOtherLanguage("https://a.example/de/", "https://a.example/")).toBe(true);
    expect(isOtherLanguage("https://a.example/tours.html", "https://a.example/")).toBe(false);
    expect(isOtherLanguage("https://a.example/en/tours", "https://a.example/en/")).toBe(false);
    expect(isOtherLanguage("https://a.example/page", "https://a.example/", "fr", "en")).toBe(true);
  });
  it("measures text similarity", () => {
    const a = shingle("one two three four five six seven eight nine ten");
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingle("completely different words appear in this other sentence here"))).toBe(0);
  });
});

describe("contact extraction", () => {
  it("finds public contacts with sources and never invents values", () => {
    const pages = result.pages.filter((p) => p.page).map((p) => ({ url: p.finalUrl!, pageType: p.pageType ?? "OTHER", page: p.page! }));
    const contacts = extractContacts(pages);
    const get = (type: string) => contacts.filter((c) => c.type === type).map((c) => c.value);
    expect(get("EMAIL")).toEqual(["hello@brightsmile.example"]);
    expect(get("PHONE")).toContain("+441134960000");
    expect(get("WHATSAPP")).toEqual(["+447911123456"]);
    expect(get("BUSINESS_NAME")).toContain("Bright Smile Dental");
    expect(get("ADDRESS")[0]).toContain("Leeds");
    expect(get("CONTACT_PAGE")).toEqual([`${site.base}/contact`]);
    expect(get("SOCIAL")).toContain("https://www.facebook.com/brightsmiledental");
    const email = contacts.find((c) => c.type === "EMAIL")!;
    expect(email.sources[0].url).toBe(`${site.base}/contact`);
    expect(email.confidence).toBe("HIGH");
  });
});

describe("evidence-based rules", () => {
  let input: AuditInput;
  beforeAll(() => {
    input = {
      homepageUrl: result.homepageUrl,
      origin: result.origin,
      robots: { ...result.robots },
      sitemaps: result.sitemaps,
      httpToHttps: result.httpToHttps,
      pages: result.pages,
      skipped: result.skipped,
      limitReached: result.limitReached,
      pageLimit: 20,
      context: { targetCity: "Bradford" },
      collectedAt: new Date(),
    };
  });
  const find = (id: string) => runRules(input).find((f) => f.ruleId === id);

  it("reports confirmed technical issues with URLs and evidence", () => {
    const broken = find("tech.broken-internal-urls")!;
    expect(broken.evidenceStatus).toBe("CONFIRMED");
    expect(broken.affectedUrls).toContain(`${site.base}/missing`);
    expect(broken.observedFacts).toMatch(/404/);

    expect(find("tech.redirect-chains")!.affectedUrls).toContain(`${site.base}/old-page`);
    expect(find("tech.sitemap-non-200")!.affectedUrls).toContain(`${site.base}/old-page`);
    expect(find("tech.viewport-missing")!.affectedUrls).toEqual([`${site.base}/about`]);
    expect(find("onpage.title-duplicate")!.observedFacts).toMatch(/"Dental Services" is used on 2 pages/);
    expect(find("onpage.h1-missing")!.affectedUrls).toContain(`${site.base}/about`);
    expect(find("tech.noindex")!.affectedUrls).toEqual([`${site.base}/thank-you`]);
    expect(find("tech.noindex")!.severity).toBe("LOW");
  });

  it("labels judgement calls as potential and data gaps as needing verification", () => {
    expect(find("content.thin-commercial-pages")!.evidenceStatus).toBe("POTENTIAL");
    expect(find("content.thin-commercial-pages")!.requiresHumanReview).toBe(true);
    expect(find("access.search-console")!.severity).toBe("NEEDS_VERIFICATION");
    expect(find("access.backlinks")!.requiresAccess).toBe(true);
    // No ranking, traffic or backlink claims are ever made from a crawl.
    for (const f of runRules(input)) expect(f.observedFacts).not.toMatch(/ranking (dropped|fell)|traffic (is|was) (low|down)|toxic/i);
  });

  it("checks the target area only when one is given", () => {
    expect(find("local.target-city-absent")!.title).toContain("Bradford");
    const noCity = runRules({ ...input, context: {} });
    expect(noCity.find((f) => f.ruleId.startsWith("local."))).toBeUndefined();
  });

  it("does not report problems that are not there", () => {
    expect(find("tech.robots-blocks-site")).toBeUndefined();
    expect(find("tech.sitemap-missing")).toBeUndefined();
    expect(find("cro.no-contact-path")).toBeUndefined();
    expect(find("tech.business-schema-missing")).toBeUndefined();
  });

  it("is not influenced by instructions embedded in page text", () => {
    const all = runRules(input);
    expect(all.some((f) => f.severity === "HIGH" || f.severity === "MEDIUM")).toBe(true);
  });

  it("sorts by priority and every finding has evidence", () => {
    const all = runRules(input);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].priority).toBeGreaterThanOrEqual(all[i].priority);
    for (const f of all) expect(f.evidence.length).toBeGreaterThan(0);
  });
});

describe("safeFetch retries", () => {
  it("retries a dropped connection but never an HTTP error status", async () => {
    let hits = 0;
    const flaky = http.createServer((req, res) => {
      hits++;
      if (req.url === "/drop" && hits === 1) return req.socket.destroy(); // "other side closed"
      if (req.url === "/error") {
        res.writeHead(500).end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end("<h1>ok</h1>");
    });
    await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(flaky.address() as AddressInfo).port}`;
    try {
      const ok = await safeFetch(`${base}/drop`, { allowPrivateNetworks: true });
      expect(ok.status).toBe(200);
      expect(hits).toBe(2);

      hits = 0;
      expect((await safeFetch(`${base}/error`, { allowPrivateNetworks: true })).status).toBe(500);
      expect(hits).toBe(1);

      hits = 0;
      await expect(safeFetch(`${base}/drop`, { allowPrivateNetworks: true, retries: 0 })).rejects.toThrow();
      expect(hits).toBe(1);
    } finally {
      await new Promise((r) => flaky.close(r));
    }
  }, 20_000);
});
