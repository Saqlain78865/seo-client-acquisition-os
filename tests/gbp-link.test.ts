import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { isGbpLink, parseMapsUrl, resolveGbpLink } from "@/lib/research/gbp-link";
import { AuditRequestError, startAuditFromGbpLink } from "@/lib/audit/service";
import { generateSections, type GenerateInput } from "@/lib/proposals/generate";

describe("Google Business Profile links", () => {
  it("recognises Maps and profile links, not ordinary websites", () => {
    expect(isGbpLink("https://maps.app.goo.gl/AbC123xyz")).toBe(true);
    expect(isGbpLink("https://www.google.com/maps/place/Dune+Buggy+Dubai/@25.1,55.2,15z")).toBe(true);
    expect(isGbpLink("maps.google.com/?q=Dune+Buggy+Dubai")).toBe(true);
    expect(isGbpLink("https://g.page/dune-buggy-dubai")).toBe(true);
    expect(isGbpLink("https://www.google.com/search?q=dune+buggy")).toBe(false);
    expect(isGbpLink("https://dunebuggydubaiprice.com/tours")).toBe(false);
    expect(isGbpLink("https://maps.example.com/maps/place/x")).toBe(false);
  });

  it("reads the business name and map position from a Maps address", () => {
    expect(parseMapsUrl("https://www.google.com/maps/place/Dune+Buggy+Dubai+Price/@25.0123,55.4567,17z/data=!3m1")).toMatchObject({ name: "Dune Buggy Dubai Price", lat: 25.0123, lng: 55.4567 });
    expect(parseMapsUrl("https://maps.google.com/?q=Bright+Smile+Dental+Leeds")).toMatchObject({ name: "Bright Smile Dental Leeds", lat: null });
    expect(parseMapsUrl("https://maps.google.com/?q=25.1,55.2").name).toBeNull();
  });

  it("follows a short link to the full address, staying on Google", async () => {
    const hops: Record<string, string> = { "https://maps.app.goo.gl/AbC": "https://www.google.com/maps/place/Sand+Tours/@24.9,55.1,15z" };
    const fakeFetch = (async (url: string) => new Response(null, { status: 302, headers: hops[url] ? { location: hops[url] } : {} })) as unknown as typeof fetch;
    expect(await resolveGbpLink("https://maps.app.goo.gl/AbC", fakeFetch)).toMatchObject({ name: "Sand Tours", lat: 24.9, lng: 55.1 });
    const offsite = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } })) as unknown as typeof fetch;
    await expect(resolveGbpLink("https://maps.app.goo.gl/Bad", offsite)).rejects.toThrow(/outside Google Maps/);
  });

  it("explains what is needed when no Places key is set", async () => {
    const user = await db.user.create({ data: { email: `gbplink${Date.now()}@test.example`, name: "G", passwordHash: "x" } });
    const ws = await createWorkspace("GBP link WS", user.id);
    await expect(startAuditFromGbpLink(ws.id, user.id, { websiteUrl: "https://maps.app.goo.gl/AbC", currency: "USD" } as never)).rejects.toThrow(AuditRequestError);
    await expect(startAuditFromGbpLink(ws.id, user.id, { websiteUrl: "https://maps.app.goo.gl/AbC", currency: "USD" } as never)).rejects.toThrow(/Places API/);
  });

  it("puts the profile first in proposals started from a profile link", () => {
    const base: GenerateInput = {
      prospect: { businessName: "Sand Tours", websiteUrl: "https://sand.example/", domain: "sand.example", industry: null, city: "Dubai", country: "UAE", primaryServices: "Desert tours" },
      audit: { createdAt: new Date(), summary: null, context: {}, scope: null, business: null, aiExplanations: {} },
      findings: [],
      services: ["TECHNICAL", "LOCAL"],
      roadmap: "90_DAY",
      gbp: { name: "Sand Tours", rating: 4.1, reviewCount: 18, category: null, address: null, mapsUrl: null, issues: [], rankings: [] } as unknown as GenerateInput["gbp"],
      consultantName: "Sara",
      companyName: "LeadLift",
    };
    const keys = (ctx: GenerateInput["audit"]) => generateSections({ ...base, audit: ctx }).map((s) => s.key);
    const websiteFirst = keys(base.audit);
    expect(websiteFirst.indexOf("gbp")).toBeGreaterThan(websiteFirst.indexOf("key_findings"));
    const profileFirst = keys({ ...base.audit!, context: { primary: "GBP" } });
    expect(profileFirst.slice(0, 3)).toEqual(["executive_summary", "gbp", "reputation"]);
  });
});
