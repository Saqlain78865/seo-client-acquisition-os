import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { saveCredentials } from "@/lib/integrations";
import { createWebsite } from "@/lib/websites";
import { checkEmailHealth, emailPitch, spfLookups, type Resolver } from "@/lib/email-health";
import { detectStack } from "@/lib/tech-stack";
import { createContentPlan, latestContentPlan, planFromData, setPlanItemStatus } from "@/lib/content-calendar";
import { monthWork } from "@/lib/work-log";
import { findProspects, placesProblem } from "@/lib/research/places-service";
import type { AiProvider } from "@/lib/ai/provider";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function resolver(records: Record<string, string[]>, mx: Record<string, string[]> = {}): Resolver {
  return {
    mx: async (d) => {
      if (!mx[d]) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      return mx[d].map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }));
    },
    txt: async (d) => {
      if (!records[d]) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return records[d].map((r) => [r]);
    },
  };
}

describe("email health (SPF, DKIM, DMARC)", () => {
  it("rates a well set-up domain", async () => {
    const h = await checkEmailHealth(
      "www.smiles.example",
      resolver(
        { "smiles.example": ["v=spf1 include:_spf.google.com ~all", "google-site-verification=x"], "google._domainkey.smiles.example": ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOC"], "_dmarc.smiles.example": ["v=DMARC1; p=quarantine; rua=mailto:d@smiles.example"] },
        { "smiles.example": ["aspmx.l.google.com"] },
      ),
    );
    expect(h.domain).toBe("smiles.example");
    expect(h.provider).toBe("Google Workspace");
    expect(h.checks.map((c) => [c.key, c.status])).toEqual([
      ["MX", "OK"],
      ["SPF", "OK"],
      ["DKIM", "OK"],
      ["DMARC", "OK"],
    ]);
    expect(h.score).toBe(100);
    expect(emailPitch(h)).toEqual([]);
  });

  it("explains what is missing or weak, as a pitch", async () => {
    const h = await checkEmailHealth("weak.example", resolver({ "weak.example": ["v=spf1 +all"], "_dmarc.weak.example": ["v=DMARC1; p=none"] }, { "weak.example": ["mx1.titan.email"] }));
    expect(h.provider).toBe("Titan email");
    expect(h.checks.map((c) => [c.key, c.status])).toEqual([
      ["MX", "OK"],
      ["SPF", "WARN"],
      ["DKIM", "MISSING"],
      ["DMARC", "WARN"],
    ]);
    expect(h.checks[1].detail).toContain("“+all”");
    expect(h.score).toBe(25 + 12 + 0 + 12);
    expect(emailPitch(h)[0]).toContain("missing SPF, DKIM, DMARC");
    expect(spfLookups("v=spf1 include:a.com include:b.com mx a ip4:1.2.3.4 ~all")).toBe(4);
    // A null MX and a revoked DKIM key (empty p=) are not a working setup.
    const parked = await checkEmailHealth("parked.example", resolver({ "google._domainkey.parked.example": ["v=DKIM1; p="] }, { "parked.example": [""] }));
    expect(parked.checks.find((c) => c.key === "MX")).toMatchObject({ status: "MISSING", detail: expect.stringContaining("null MX") });
    expect(parked.checks.find((c) => c.key === "DKIM")?.status).toBe("MISSING");
    const none = await checkEmailHealth("nothing.example", resolver({}));
    expect(none.checks.every((c) => c.status === "MISSING")).toBe(true);
  });
});

describe("tech stack detector", () => {
  it("recognises the platform, plugins and tools, and turns gaps into pitch notes", () => {
    const html = `<html><head><meta name="generator" content="WordPress 6.4.2"><link href="/wp-content/plugins/elementor/assets/a.css"><link href="/wp-content/plugins/contact-form-7/x.css"><script src="/wp-content/themes/x/jquery.min.js"></script></head><body class="home elementor-page"><a href="https://wa.me/923001234567">WhatsApp</a><script src="https://connect.facebook.net/en_US/fbevents.js"></script></body></html>`;
    const s = detectStack(html, { Server: "LiteSpeed", "X-Powered-By": "PHP/7.4.33" });
    const names = s.technologies.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["WordPress", "Elementor", "Meta Pixel", "WhatsApp chat button", "LiteSpeed", "PHP", "jQuery"]));
    expect(s.technologies.find((t) => t.name === "WordPress")?.version).toBe("6.4.2");
    expect(s.technologies.find((t) => t.name === "PHP")?.version).toBe("7.4.33");
    expect(s.wpPlugins).toEqual(["contact-form-7", "elementor"]);
    expect(s.pitch.join(" ")).toMatch(/without an SEO plugin/);
    expect(s.pitch.join(" ")).toMatch(/No Google Analytics/);
    expect(s.pitch.join(" ")).toMatch(/paid ads/);
    expect(s.pitch.join(" ")).toMatch(/PHP 7\.4\.33/);
    expect(s.pitch.join(" ")).not.toMatch(/No chat/);
    const wix = detectStack(`<img src="https://static.wixstatic.com/media/x.jpg"><script src="https://www.googletagmanager.com/gtag/js?id=G-ABC"></script>`, {});
    expect(wix.technologies.map((t) => t.name)).toEqual(["Wix", "Google Analytics"]);
    expect(wix.pitch[0]).toMatch(/Wix site/);
  });
});

describe("content calendar", () => {
  const rows = [
    { query: "how much do braces cost", page: "https://x.example/", clicks: 2, impressions: 400, position: 14 },
    { query: "dentist clifton karachi", page: "https://x.example/", clicks: 5, impressions: 300, position: 11 },
    { query: "teeth whitening karachi", page: "https://x.example/whitening", clicks: 3, impressions: 250, position: 9.5 },
    { query: "dental implants", page: "https://x.example/", clicks: 0, impressions: 90, position: 35 },
    { query: "smiles dental", page: "https://x.example/", clicks: 80, impressions: 600, position: 1.2 },
    { query: "x", page: "https://x.example/", clicks: 0, impressions: 900, position: 30 },
  ];

  it("plans topics from the numbers alone, three a month, biggest first", () => {
    const plan = planFromData(rows, "https://x.example/");
    expect(plan.map((p) => [p.kind, p.keyword, p.monthIndex])).toEqual([
      ["FAQ", "how much do braces cost", 0],
      ["SERVICE_PAGE", "dentist clifton karachi", 0],
      ["REFRESH", "teeth whitening karachi", 0],
      ["NEW_ARTICLE", "dental implants", 1],
    ]);
    expect(plan[0].title).toBe("How Much Do Braces Cost?");
    expect(plan[2].linkTo).toBe("https://x.example/whitening");
  });

  it("builds and keeps a plan, with Gemini when available, and logs done topics as work", async () => {
    const user = await db.user.create({ data: { email: `cc${Date.now()}@test.example`, name: "C", passwordHash: "x" } });
    const ws = await createWorkspace("CC WS", user.id);
    const site = await createWebsite(ws.id, user.id, { name: "Smiles", url: `https://cc${Date.now()}.example/`, kind: "CLIENT" });
    await expect(createContentPlan(ws.id, site.id, fetch, new Date(), null)).rejects.toThrow(/Search Console property/);
    await db.website.update({ where: { id: site.id }, data: { gscSiteUrl: `sc-domain:${site.domain}` } });
    await saveCredentials(ws.id, "GOOGLE_OAUTH_APP", { secret: { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" } });
    await saveCredentials(ws.id, "SEARCH_CONSOLE", { secret: { refreshToken: "r" }, accountLabel: "me@example.com" });
    const fake = (async (url: string) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "t", expires_in: 3600 });
      return json({ rows: rows.map((r) => ({ keys: [r.query, r.page], clicks: r.clicks, impressions: r.impressions, ctr: 0, position: r.position })) });
    }) as unknown as typeof fetch;
    const now = new Date("2026-11-02T10:00:00Z");

    // Without Gemini: the plan comes from the data.
    const plain = await createContentPlan(ws.id, site.id, fake, now, null);
    expect(plain).toMatchObject({ source: "DATA", startMonth: "2026-12" });
    expect(plain.items[0]).toMatchObject({ month: "2026-12", keyword: "how much do braces cost" });

    // With Gemini: its ideas are kept, links outside the site are dropped.
    const ai: AiProvider = {
      name: "fake",
      model: "fake",
      generateJson: async () =>
        ({
          items: Array.from({ length: 8 }, (_, i) => ({ monthIndex: i % 12, title: `Topic ${i}: braces guide`, keyword: "how much do braces cost", kind: "NEW_ARTICLE", reason: "400 impressions at position 14.", linkTo: i === 0 ? "https://x.example/whitening" : "https://evil.example/" })),
        }) as never,
    };
    const smart = await createContentPlan(ws.id, site.id, fake, now, ai);
    expect(smart.source).toBe("AI");
    expect(smart.items).toHaveLength(8);
    expect(smart.items[0].linkTo).toBe("https://x.example/whitening");
    expect(smart.items[1].linkTo).toBeNull();
    expect((await latestContentPlan(ws.id, site.id))?.id).toBe(smart.id);

    await setPlanItemStatus(ws.id, smart.items[0].id, "DONE");
    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    expect((await monthWork(ws.id, site.id, month)).map((w) => [w.category, w.title])).toEqual([["NEW_CONTENT", "Topic 0: braces guide"]]);
    await expect(setPlanItemStatus("other", smart.items[1].id, "DONE")).rejects.toThrow(/not found/);
  });
});

describe("Google Places availability", () => {
  it("remembers Google's refusal so the Finder can explain it instead of failing again", async () => {
    const user = await db.user.create({ data: { email: `gp${Date.now()}@test.example`, name: "G", passwordHash: "x" } });
    const ws = await createWorkspace("GP WS", user.id);
    await saveCredentials(ws.id, "PLACES", { secret: { apiKey: "k" } });
    const blocked = (async () => json({ error: { message: "Requests to this API places.googleapis.com method google.maps.places.v1.Places.SearchText are blocked.", status: "PERMISSION_DENIED" } }, 403)) as unknown as typeof fetch;
    await expect(findProspects(ws.id, "dentist Dubai", blocked)).rejects.toThrow(/blocked/);
    expect(await placesProblem(ws.id)).toMatch(/blocked/);
    const ok = (async () => json({ places: [] })) as unknown as typeof fetch;
    await findProspects(ws.id, "dentist Dubai", ok);
    expect(await placesProblem(ws.id)).toBeNull();
  });
});
