import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { saveCredentials } from "@/lib/integrations";
import { GscError, linkSite, listSites, matchSite, monthResults, syncProspect, totals } from "@/lib/search-console";
import { checkSiteChanges, compare, monthChanges } from "@/lib/site-changes";
import { runnerOptions } from "@/lib/audit/runner";

async function setup(name: string, websiteUrl = `${name}${Date.now()}.example`) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  const p = await createProspect(ws.id, user.id, { businessName: "Sky Balloons", websiteUrl, currency: "AED" });
  return { userId: user.id, workspaceId: ws.id, prospect: p };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Search Console (read-only)", () => {
  it("lists properties, links the matching one, syncs daily totals and compares months", async () => {
    const { userId, workspaceId, prospect } = await setup("gsc", "skyballoons.example");
    await expect(listSites(workspaceId)).rejects.toThrow(GscError);
    await saveCredentials(workspaceId, "GOOGLE_OAUTH_APP", { secret: { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" } });
    await saveCredentials(workspaceId, "SEARCH_CONSOLE", { secret: { refreshToken: "refresh-1" }, accountLabel: "me@example.com" });

    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        expect(String(init?.body)).toContain("client_secret=GOCSPX-test");
        return json({ access_token: "tok", expires_in: 3600 });
      }
      if (url.endsWith("/sites")) return json({ siteEntry: [{ siteUrl: "sc-domain:skyballoons.example", permissionLevel: "siteOwner" }, { siteUrl: "https://other.example/", permissionLevel: "siteUnverifiedUser" }] });
      const body = JSON.parse(String(init?.body ?? "{}")) as { dimensions: string[]; startDate: string };
      if (body.dimensions[0] === "date") {
        const rows = Array.from({ length: 60 }, (_, i) => {
          const d = new Date(Date.UTC(2026, 8, 1) + i * 86400_000).toISOString().slice(0, 10);
          return { keys: [d], clicks: d.startsWith("2026-10") ? 20 : 10, impressions: 400, ctr: 0.05, position: d.startsWith("2026-10") ? 8 : 12 };
        });
        return json({ rows });
      }
      const oct = body.startDate === "2026-10-01";
      return json({ rows: body.dimensions[0] === "query" ? [{ keys: ["balloon ride dubai"], clicks: oct ? 90 : 40, impressions: 900, ctr: 0.1, position: oct ? 4.2 : 9.1 }] : [{ keys: ["https://skyballoons.example/"], clicks: oct ? 120 : 80, impressions: 2000, ctr: 0.06, position: 6 }] });
    }) as unknown as typeof fetch;

    const sites = await listSites(workspaceId, fake);
    expect(sites.map((s) => s.siteUrl)).toEqual(["sc-domain:skyballoons.example"]);
    expect(matchSite(sites, "www.skyballoons.example")).toBe("sc-domain:skyballoons.example");
    await expect(linkSite(workspaceId, userId, prospect.id, "https://not-mine.example/", fake)).rejects.toThrow(/cannot see/);
    expect(await linkSite(workspaceId, userId, prospect.id, "sc-domain:skyballoons.example", fake)).toBe(60);
    expect(await db.gscDaily.count({ where: { prospectId: prospect.id } })).toBe(60);
    // A second sync replaces the recent days instead of adding duplicates.
    await syncProspect(workspaceId, prospect.id, fake);
    expect(await db.gscDaily.count({ where: { prospectId: prospect.id } })).toBe(60);

    const r = (await monthResults(workspaceId, prospect.id, "2026-10", fake))!;
    expect(r.current.clicks).toBe(20 * 30);
    expect(r.previous.clicks).toBe(10 * 30);
    expect(r.current.position).toBeCloseTo(8);
    expect(r.queries[0]).toMatchObject({ key: "balloon ride dubai", clicks: 90, previousClicks: 40, previousPosition: 9.1 });
    expect(r.detailError).toBeNull();
    // Only read calls: nothing is ever written to Search Console.
    expect(calls.every((u) => u.includes("oauth2") || u.includes("/sites") || u.includes("searchAnalytics/query"))).toBe(true);
    expect(totals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
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

  it("records a baseline, then reports new, changed and removed pages", async () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    pages["/"] = page("Sky Balloons", `<h1>Balloon rides</h1><p>${words(200)}</p><a href="/tours">Tours</a><a href="/old">Old</a>`);
    pages["/tours"] = page("Tours", `<h1>Tours</h1><p>${words(150)}</p>`);
    pages["/old"] = page("Old offer", `<h1>Old</h1><p>${words(80)}</p>`);
    const { workspaceId, prospect } = await setup("chg", `${base}/`);

    expect(await checkSiteChanges(workspaceId, prospect.id)).toMatchObject({ baseline: true, changes: 0, pages: 3 });

    pages["/"] = page("Hot Air Balloon Rides in Dubai | Sky Balloons", `<h1>Balloon rides</h1><p>${words(200)}</p><a href="/tours">Tours</a><a href="/faq">FAQ</a>`, "Sunrise flights over the desert.");
    pages["/tours"] = page("Tours", `<h1>Sunrise balloon tours</h1><p>${words(400)}</p>`);
    pages["/faq"] = page("FAQ", `<h1>FAQ</h1><p>${words(120)}</p>`);
    delete pages["/old"];

    const r = await checkSiteChanges(workspaceId, prospect.id);
    expect(r.baseline).toBe(false);
    const found = await db.siteChange.findMany({ where: { prospectId: prospect.id } });
    const kinds = found.map((c) => `${c.kind} ${new URL(c.url).pathname}`).sort();
    expect(kinds).toEqual(["CONTENT /tours", "H1 /tours", "META_DESCRIPTION /", "NEW_PAGE /faq", "REMOVED_PAGE /old", "TITLE /"]);
    expect(found.find((c) => c.kind === "TITLE")).toMatchObject({ before: "Sky Balloons", after: "Hot Air Balloon Rides in Dubai | Sky Balloons" });
    const month = new Date().toISOString().slice(0, 7);
    expect((await monthChanges(workspaceId, prospect.id, month)).length).toBe(6);

    // Nothing changed: nothing new is recorded.
    expect((await checkSiteChanges(workspaceId, prospect.id)).changes).toBe(0);
  }, 120_000);

  it("ignores tiny text edits but reports real content changes", () => {
    const s = { url: "u", status: 200, title: "T", metaDescription: null, h1: "H", canonical: null, robotsMeta: null, wordCount: 1000, contentHash: "a" };
    expect(compare(s, { ...s, contentHash: "b", wordCount: 1010 })).toEqual([]);
    expect(compare(s, { ...s, contentHash: "b", wordCount: 1200 })).toEqual([{ kind: "CONTENT", before: "1000 words", after: "1200 words" }]);
    expect(compare(s, { ...s, robotsMeta: "noindex" })).toEqual([{ kind: "INDEXING", before: "indexable", after: "noindex" }]);
  });
});
