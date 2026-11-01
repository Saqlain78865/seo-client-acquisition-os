import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { saveCredentials } from "@/lib/integrations";
import { createWebsite, WebsiteError } from "@/lib/websites";
import { GscError, explore, linkWebsite, listSites, matchSite, monthReport, previousOf, propertyMatches, rangeFor, totals } from "@/lib/search-console";
import { checkSiteChanges, compare, monthChanges } from "@/lib/site-changes";
import { runnerOptions } from "@/lib/audit/runner";

async function workspace(name: string) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  return { userId: user.id, workspaceId: ws.id };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("My Websites + Search Console (read-only)", () => {
  it("only accepts a website's own property", () => {
    expect(propertyMatches("sc-domain:skyballoons.example", "skyballoons.example")).toBe(true);
    expect(propertyMatches("https://www.skyballoons.example/", "skyballoons.example")).toBe(true);
    expect(propertyMatches("https://blog.skyballoons.example/", "skyballoons.example")).toBe(false);
    expect(propertyMatches("sc-domain:other.example", "skyballoons.example")).toBe(false);
    expect(matchSite([{ siteUrl: "https://skyballoons.example/", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:skyballoons.example", permissionLevel: "siteOwner" }], "skyballoons.example")).toBe("sc-domain:skyballoons.example");
  });

  it("works out date ranges and the previous period", () => {
    const r = rangeFor({ days: 7 }, new Date("2026-11-10T12:00:00Z"));
    expect(r).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(previousOf(r)).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(totals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  it("links the website's own property and explores queries with the previous period", async () => {
    const { userId, workspaceId } = await workspace("gsc");
    await expect(createWebsite(workspaceId, userId, { name: "Sky", url: "nodot", kind: "OWN" })).rejects.toThrow(WebsiteError);
    const site = await createWebsite(workspaceId, userId, { name: "Sky Balloons", url: "https://www.skyballoons.example/tours", kind: "OWN" });
    expect(site).toMatchObject({ domain: "skyballoons.example", url: "https://www.skyballoons.example/" });
    await expect(createWebsite(workspaceId, userId, { name: "Again", url: "skyballoons.example", kind: "CLIENT" })).rejects.toThrow(/already/);

    await expect(listSites(workspaceId)).rejects.toThrow(GscError);
    await saveCredentials(workspaceId, "GOOGLE_OAUTH_APP", { secret: { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" } });
    await saveCredentials(workspaceId, "SEARCH_CONSOLE", { secret: { refreshToken: "refresh-1" }, accountLabel: "me@example.com" });

    const bodies: { dimensions: string[]; startDate: string; endDate: string; dimensionFilterGroups?: unknown }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.endsWith("/sites")) return json({ siteEntry: [{ siteUrl: "sc-domain:skyballoons.example", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:other.example", permissionLevel: "siteOwner" }] });
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      expect(init?.method).toBe("POST");
      const current = body.startDate === "2026-10-01";
      if (body.dimensions[0] === "date") return json({ rows: [{ keys: [body.startDate], clicks: current ? 30 : 10, impressions: 600, ctr: 0.05, position: current ? 6 : 9 }] });
      return json({ rows: [{ keys: ["balloon ride dubai"], clicks: current ? 25 : 8, impressions: 300, ctr: 0.08, position: current ? 4.1 : 8.5 }, ...(current ? [{ keys: ["sunrise balloon"], clicks: 5, impressions: 90, ctr: 0.05, position: 7 }] : [])] });
    }) as unknown as typeof fetch;

    // Another website's property is refused, even though the account can see it.
    await expect(linkWebsite(workspaceId, userId, site.id, "sc-domain:other.example", fake)).rejects.toThrow(/not a property of skyballoons.example/);
    await expect(explore(workspaceId, site.id, { dimension: "query" }, fake)).rejects.toThrow(/Link this website/);
    await linkWebsite(workspaceId, userId, site.id, "sc-domain:skyballoons.example", fake);

    const r = await explore(workspaceId, site.id, { start: "2026-10-01", end: "2026-10-31", compare: true, dimension: "query", search: "balloon" }, fake);
    expect(r.previousRange).toEqual({ start: "2026-08-31", end: "2026-09-30" });
    expect(r.totals.clicks).toBe(30);
    expect(r.previousTotals?.clicks).toBe(10);
    expect(r.rows[0]).toMatchObject({ key: "balloon ride dubai", clicks: 25, previous: { clicks: 8, position: 8.5 } });
    expect(r.rows[1]).toMatchObject({ key: "sunrise balloon", previous: null });
    expect(bodies.some((b) => JSON.stringify(b.dimensionFilterGroups ?? "").includes('"operator":"contains","expression":"balloon"'))).toBe(true);

    // The monthly report compares with the previous calendar month.
    const m = await monthReport(workspaceId, site.id, "2026-10", fake);
    expect(m.queries.previousRange).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(m.queries.totals.clicks).toBe(30);
  });
});

describe("website change log", () => {
  let server: http.Server;
  let base = "";
  const pages: Record<string, string> = {};
  const page = (title: string, body: string, desc = "") => `<!doctype html><html><head><title>${title}</title>${desc ? `<meta name="description" content="${desc}">` : ""}</head><body>${body}</body></html>`;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const html = pages[req.url ?? "/"];
      if (!html) return void res.writeHead(404).end("<h1>Not found</h1>");
      res.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    runnerOptions.allowPrivateNetworks = true;
  });
  afterAll(() => {
    runnerOptions.allowPrivateNetworks = false;
    server.close();
  });

  it("records a baseline, then reports new, changed and removed pages — for My Websites and won clients alike", async () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    pages["/"] = page("Sky Balloons", `<h1>Balloon rides</h1><p>${words(200)}</p><a href="/tours">Tours</a><a href="/old">Old</a>`);
    pages["/tours"] = page("Tours", `<h1>Tours</h1><p>${words(150)}</p>`);
    pages["/old"] = page("Old offer", `<h1>Old</h1><p>${words(80)}</p>`);
    const { userId, workspaceId } = await workspace("chg");
    const site = await db.website.create({ data: { workspaceId, name: "Local", url: `${base}/`, domain: "127.0.0.1" } });
    const client = await createProspect(workspaceId, userId, { businessName: "Client", websiteUrl: `${base}/`, currency: "USD" });

    expect(await checkSiteChanges(workspaceId, { websiteId: site.id })).toMatchObject({ baseline: true, changes: 0, pages: 3 });
    expect((await checkSiteChanges(workspaceId, { prospectId: client.id })).baseline).toBe(true);

    pages["/"] = page("Hot Air Balloon Rides in Dubai | Sky Balloons", `<h1>Balloon rides</h1><p>${words(200)}</p><a href="/tours">Tours</a><a href="/faq">FAQ</a>`, "Sunrise flights over the desert.");
    pages["/tours"] = page("Tours", `<h1>Sunrise balloon tours</h1><p>${words(400)}</p>`);
    pages["/faq"] = page("FAQ", `<h1>FAQ</h1><p>${words(120)}</p>`);
    delete pages["/old"];

    await checkSiteChanges(workspaceId, { websiteId: site.id });
    const found = await db.siteChange.findMany({ where: { websiteId: site.id } });
    expect(found.map((c) => `${c.kind} ${new URL(c.url).pathname}`).sort()).toEqual(["CONTENT /tours", "H1 /tours", "META_DESCRIPTION /", "NEW_PAGE /faq", "REMOVED_PAGE /old", "TITLE /"]);
    expect(found.find((c) => c.kind === "TITLE")).toMatchObject({ before: "Sky Balloons", after: "Hot Air Balloon Rides in Dubai | Sky Balloons" });
    const month = new Date().toISOString().slice(0, 7);
    expect((await monthChanges(workspaceId, { websiteId: site.id }, month)).length).toBe(6);
    // The website and the prospect keep separate logs.
    expect(await db.siteChange.count({ where: { prospectId: client.id } })).toBe(0);
    expect((await checkSiteChanges(workspaceId, { websiteId: site.id })).changes).toBe(0);
  }, 120_000);

  it("ignores tiny text edits but reports real content changes", () => {
    const s = { url: "u", status: 200, title: "T", metaDescription: null, h1: "H", canonical: null, robotsMeta: null, wordCount: 1000, contentHash: "a" };
    expect(compare(s, { ...s, contentHash: "b", wordCount: 1010 })).toEqual([]);
    expect(compare(s, { ...s, contentHash: "b", wordCount: 1200 })).toEqual([{ kind: "CONTENT", before: "1000 words", after: "1200 words" }]);
    expect(compare(s, { ...s, robotsMeta: "noindex" })).toEqual([{ kind: "INDEXING", before: "indexable", after: "noindex" }]);
  });
});
