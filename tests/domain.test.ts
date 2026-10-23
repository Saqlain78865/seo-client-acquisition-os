import { describe, expect, it } from "vitest";
import { detectTech, domainSignals, rdapLookup, waybackHistory, type DomainOverview } from "@/lib/research/domain";
import { trancoRank } from "@/lib/research/tranco";
import { domainFindings } from "@/lib/audit/domain-findings";
import { opportunityScore } from "@/lib/audit/opportunity";
import { parseSiteList } from "@/lib/audit/bulk";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("domain overview sources", () => {
  it("parses RDAP registration events and the registrar, and sends a user agent", async () => {
    let ua: string | null = null;
    const fake = (async (_url: string, init?: RequestInit) => {
      ua = new Headers(init?.headers).get("user-agent");
      return json({
        events: [
          { eventAction: "registration", eventDate: "2025-08-11T09:34:09Z" },
          { eventAction: "expiration", eventDate: "2027-08-11T09:34:09Z" },
        ],
        entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Network Solutions, LLC"]]] }],
      });
    }) as typeof fetch;
    expect(await rdapLookup("example.com", fake)).toEqual({ registeredAt: "2025-08-11T09:34:09Z", expiresAt: "2027-08-11T09:34:09Z", updatedAt: null, registrar: "Network Solutions, LLC" });
    expect(ua).toMatch(/SEOClientAcquisitionOS/);
    await expect(rdapLookup("example.zz", (async () => json({}, 404)) as typeof fetch)).rejects.toThrow(/No registration record/);
  });

  it("reads first and last Wayback captures", async () => {
    const fake = (async (url: string) => json(url.includes("limit=1&") ? [["timestamp"], ["20211129001647"]] : [["timestamp"], ["20260313080000"]])) as typeof fetch;
    expect(await waybackHistory("example.com", fake)).toEqual({ firstCapture: "2021-11-29", lastCapture: "2026-03-13" });
  });

  it("finds Tranco ranks in a CRLF list, with or without www", async () => {
    const fake = (async (url: string) =>
      url.endsWith("top-1m-id") ? new Response("TEST1") : new Response("1,google.com\r\n2,www.example.org\r\n751,python.org\r\n3,last.com")) as typeof fetch;
    expect((await trancoRank("python.org", fake)).rank).toBe(751);
    expect((await trancoRank("www.google.com", fake)).rank).toBe(1);
    expect((await trancoRank("example.org", fake)).rank).toBe(2);
    expect((await trancoRank("last.com", fake)).rank).toBe(3);
    expect((await trancoRank("ogle.com", fake)).rank).toBeNull();
    expect((await trancoRank("small-business.example", fake)).rank).toBeNull();
  });

  it("detects CMS, analytics and other technology from homepage HTML", () => {
    const html = `<link href="/wp-content/themes/x.css"><script src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script><a href="https://wa.me/971500000000">Chat</a><div class="elementor">`;
    expect(detectTech(html)).toEqual({ cms: "WordPress", analytics: ["Google Analytics 4"], other: ["Elementor", "WhatsApp chat button"] });
    expect(detectTech("<html><body>Hello</body></html>")).toEqual({ cms: null, analytics: [], other: [] });
  });

  it("turns results into honest, plain-language signals", () => {
    const base: Omit<DomainOverview, "signals"> = {
      domain: "example.com",
      checkedAt: new Date().toISOString(),
      registration: { ok: true, registeredAt: new Date(Date.now() - 200 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), updatedAt: null, registrar: null },
      history: { ok: true, firstCapture: "2015-01-01", lastCapture: "2026-01-01" },
      popularity: { ok: true, rank: null, listId: "X", listDate: "2026-10-22" },
      ssl: { ok: true, issuer: "Let's Encrypt", validTo: new Date().toISOString(), daysLeft: 10 },
      email: { ok: true, mx: true, spf: "v=spf1 -all", dmarc: null },
      tech: { ok: true, cms: "Wix", analytics: [], other: [] },
    };
    const text = domainSignals(base).map((s) => s.text).join("\n");
    expect(text).toMatch(/Young domain/);
    expect(text).toMatch(/expires on .* \(\d+ days\)/);
    expect(text).toMatch(/used before/);
    expect(text).toMatch(/Not in the world's top 1 million/);
    expect(text).toMatch(/SSL certificate expires in 10 days/);
    expect(text).toMatch(/no DMARC record/);
    expect(text).not.toMatch(/No SPF/);
    expect(text).toMatch(/No Google Analytics/);
    expect(text).toMatch(/built with Wix/);

    // A failed source produces no signal at all — nothing is guessed.
    const failed = domainSignals({ ...base, registration: { ok: false, error: "x" }, history: { ok: false, error: "x" }, popularity: { ok: false, error: "x" }, ssl: { ok: false, error: "x" }, email: { ok: false, error: "x" }, tech: { ok: false, error: "x" } });
    expect(failed).toEqual([]);
  });
});

describe("domain findings in the audit", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");
  const day = 86_400_000;
  const base: Omit<DomainOverview, "signals"> = {
    domain: "example.com",
    checkedAt: "2026-10-22T00:00:00.000Z",
    registration: { ok: true, registeredAt: new Date(now - 120 * day).toISOString(), expiresAt: new Date(now + 20 * day).toISOString(), updatedAt: null, registrar: "Registrar Inc" },
    history: { ok: true, firstCapture: "2026-07-01", lastCapture: "2026-10-01" },
    popularity: { ok: false, error: "Not checked" },
    ssl: { ok: true, issuer: "Let's Encrypt", validTo: new Date(now + 5 * day).toISOString(), daysLeft: 5 },
    email: { ok: true, mx: true, spf: "v=spf1 -all", dmarc: null },
    tech: { ok: true, cms: "WordPress", analytics: [], other: [] },
  };

  it("turns observed domain problems into evidence-backed findings", () => {
    const f = domainFindings(base, "https://example.com/", now);
    const byRule = Object.fromEntries(f.map((x) => [x.ruleId, x]));
    expect(Object.keys(byRule).sort()).toEqual(["domain.email-auth-missing", "domain.no-analytics", "domain.registration-expiring", "domain.ssl-expiring", "domain.young"]);
    expect(byRule["domain.no-analytics"].category).toBe("Conversion");
    expect(byRule["domain.ssl-expiring"].severity).toBe("HIGH");
    expect(byRule["domain.registration-expiring"].severity).toBe("HIGH");
    expect(byRule["domain.email-auth-missing"].title).toBe("Email on the domain has no DMARC record");
    expect(byRule["domain.young"].severity).toBe("OPPORTUNITY");
    for (const x of f) {
      expect(x.evidence.length).toBeGreaterThan(0);
      expect(x.affectedUrls).toEqual(["https://example.com/"]);
    }
  });

  it("reports nothing for healthy or unavailable sources, and flags a previously used domain", () => {
    const healthy = domainFindings(
      {
        ...base,
        registration: { ok: true, registeredAt: "2010-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z", updatedAt: null, registrar: null },
        ssl: { ok: true, issuer: null, validTo: "2027-06-01T00:00:00Z", daysLeft: 200 },
        email: { ok: true, mx: true, spf: "v=spf1 -all", dmarc: "v=DMARC1; p=none" },
        tech: { ok: true, cms: null, analytics: ["Google Analytics 4"], other: [] },
      },
      "https://example.com/",
      now,
    );
    expect(healthy).toEqual([]);
    const failed = domainFindings({ ...base, registration: { ok: false, error: "x" }, ssl: { ok: false, error: "x" }, email: { ok: false, error: "x" }, tech: { ok: false, error: "x" } }, "https://example.com/", now);
    expect(failed).toEqual([]);
    const reused = domainFindings({ ...base, history: { ok: true, firstCapture: "2012-03-01", lastCapture: "2026-01-01" } }, "https://example.com/", now);
    expect(reused.map((x) => x.ruleId)).toContain("domain.previous-owner-history");
    expect(reused.map((x) => x.ruleId)).not.toContain("domain.young");
  });
});

describe("opportunity score", () => {
  const f = (severity: string, ruleId = "x", evidenceStatus = "CONFIRMED") => ({ severity, evidenceStatus, title: `${severity} ${ruleId}`, priority: 50, ruleId });

  it("ranks sites with more confirmed work and a contact higher", () => {
    const hot = opportunityScore([f("CRITICAL"), f("HIGH"), f("HIGH"), f("MEDIUM", "domain.no-analytics"), f("MEDIUM", "local.target-city-absent")], true);
    const cold = opportunityScore([f("LOW"), f("NEEDS_VERIFICATION"), f("HIGH", "y", "HYPOTHESIS")], false);
    expect(hot.grade).toBe("HOT");
    expect(hot.score).toBeGreaterThan(60);
    expect(hot.reasons).toHaveLength(3);
    expect(cold.grade).toBe("COLD");
    expect(cold.score).toBe(2);
    expect(cold.reasons).toContain("No email or phone found yet");
    expect(opportunityScore(Array.from({ length: 40 }, () => f("CRITICAL")), true).score).toBeLessThanOrEqual(100);
  });
});

describe("bulk site list", () => {
  it("normalises, de-duplicates by domain and reports invalid entries", () => {
    const { urls, invalid } = parseSiteList("example.com\nhttps://www.example.com/, shop.example.org;  http://Third.example.net/path\nnot-a-site\n\n");
    expect(urls).toEqual(["https://example.com", "https://shop.example.org", "http://third.example.net/path"]);
    expect(invalid).toEqual(["not-a-site"]);
  });
});
