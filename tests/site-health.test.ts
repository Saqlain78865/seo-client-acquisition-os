import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { saveCredentials } from "@/lib/integrations";
import { createWebsite } from "@/lib/websites";
import { runnerOptions } from "@/lib/audit/runner";
import { checkRobotsAndSitemap, indexReason, indexSummary, runIndexCheck } from "@/lib/site-health";
import { CompetitorWatchError, addWatchedCompetitor, checkCompetitorNow, competitorActivity, removeWatchedCompetitor } from "@/lib/competitor-watch";

// A small website whose robots.txt, sitemap and pages each test changes.
const site = {
  robots: "User-agent: *\nAllow: /\n",
  sitemap: true,
  noindex: false,
  pages: { "/": "Home", "/services": "Services" } as Record<string, string>,
};
let server: http.Server;
let base = "";

async function setup(name: string) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  const w = await createWebsite(ws.id, user.id, { name: "Sky", url: `https://${name}${Date.now()}.example/`, kind: "CLIENT" });
  return { workspaceId: ws.id, userId: user.id, websiteId: w.id, domain: w.domain };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/robots.txt") return res.writeHead(200, { "content-type": "text/plain" }), res.end(site.robots);
    if (url === "/sitemap.xml") {
      if (!site.sitemap) return res.writeHead(404), res.end();
      return res.writeHead(200, { "content-type": "application/xml" }), res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(site.pages).map((p) => `<url><loc>${base}${p.slice(1)}</loc></url>`).join("")}</urlset>`);
    }
    if (url === "/sitemap_index.xml") return res.writeHead(404), res.end();
    const title = site.pages[url];
    if (!title) return res.writeHead(404, { "content-type": "text/html" }), res.end("<html><body>nope</body></html>");
    const links = Object.keys(site.pages).map((p) => `<a href="${p}">${site.pages[p]}</a>`).join(" ");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>${title}</title>${site.noindex && url === "/" ? '<meta name="robots" content="noindex">' : ""}</head><body><h1>${title}</h1><p>${"Plenty of words about the business. ".repeat(30)}</p>${links}</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  runnerOptions.allowPrivateNetworks = true;
});
afterAll(() => {
  runnerOptions.allowPrivateNetworks = false;
  server.close();
});

describe("robots.txt and sitemap monitor", () => {
  it("alerts when Google is blocked or the sitemap breaks, and closes the alert once fixed", async () => {
    const s = await setup("robots");
    await db.website.update({ where: { id: s.websiteId }, data: { url: base } });
    expect((await checkRobotsAndSitemap(s.workspaceId, s.websiteId))?.problems).toEqual([]);

    site.robots = "User-agent: *\nDisallow: /\n";
    site.sitemap = false;
    site.noindex = true;
    expect((await checkRobotsAndSitemap(s.workspaceId, s.websiteId))?.problems).toEqual(["robots", "noindex", "sitemap"]);
    await checkRobotsAndSitemap(s.workspaceId, s.websiteId);
    const open = await db.siteAlert.findMany({ where: { websiteId: s.websiteId, resolvedAt: null } });
    // Raised once each, even when checked again.
    expect(open.map((a) => a.title).sort()).toEqual(["No working sitemap found", "The home page is set to noindex", "robots.txt blocks Google from the whole website"]);
    expect(await db.notification.count({ where: { workspaceId: s.workspaceId, title: { contains: "robots.txt was changed" } } })).toBe(1);

    site.robots = "User-agent: *\nAllow: /\n";
    site.sitemap = true;
    site.noindex = false;
    expect((await checkRobotsAndSitemap(s.workspaceId, s.websiteId))?.problems).toEqual([]);
    expect(await db.siteAlert.count({ where: { websiteId: s.websiteId, resolvedAt: null } })).toBe(0);
  }, 60_000);
});

describe("Google indexing check", () => {
  it("stores each page's index status, explains why pages are not indexed and alerts on a drop", async () => {
    const s = await setup("index");
    await db.website.update({ where: { id: s.websiteId }, data: { url: `https://${s.domain}/`, gscSiteUrl: `sc-domain:${s.domain}` } });
    await saveCredentials(s.workspaceId, "GOOGLE_OAUTH_APP", { secret: { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" } });
    await saveCredentials(s.workspaceId, "SEARCH_CONSOLE", { secret: { refreshToken: "r" }, accountLabel: "me@example.com" });
    await db.pageSnapshot.createMany({ data: ["blog", "about", "old"].map((p) => ({ websiteId: s.websiteId, url: `https://${s.domain}/${p}`, status: 200 })) });
    let blogIndexed = true;
    const asked: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      const b = JSON.parse(String(init?.body));
      asked.push(b.inspectionUrl);
      expect(b.siteUrl).toBe(`sc-domain:${s.domain}`);
      const pass = { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL" };
      const r = b.inspectionUrl.endsWith("/old")
        ? { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" }
        : b.inspectionUrl.endsWith("/blog") && !blogIndexed
          ? { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", indexingState: "BLOCKED_BY_META_TAG", pageFetchState: "SUCCESSFUL" }
          : pass;
      return new Response(JSON.stringify({ inspectionResult: { indexStatusResult: r } }));
    }) as unknown as typeof fetch;

    await runIndexCheck(s.workspaceId, s.websiteId, fake);
    expect(asked[0]).toBe(`https://${s.domain}/`);
    let sum = await indexSummary(s.workspaceId, s.websiteId);
    expect(sum).toMatchObject({ total: 4, indexed: 3 });
    expect(sum.notIndexed).toEqual([expect.objectContaining({ url: `https://${s.domain}/old`, reason: "Discovered - currently not indexed" })]);

    blogIndexed = false;
    await runIndexCheck(s.workspaceId, s.websiteId, fake);
    sum = await indexSummary(s.workspaceId, s.websiteId);
    expect(sum.indexed).toBe(2);
    expect(sum.reasons).toEqual(expect.arrayContaining([{ reason: "Has a noindex tag", count: 1 }]));
    const alert = await db.siteAlert.findFirstOrThrow({ where: { websiteId: s.websiteId, kind: "INDEXING" } });
    expect(alert.title).toBe("1 page dropped out of Google's index");
    expect(indexReason({ verdict: "FAIL", coverageState: null, robotsTxtState: "DISALLOWED", indexingState: null, pageFetchState: null, googleCanonical: null, userCanonical: null })).toBe("Blocked by robots.txt");
  });
});

describe("competitor watch", () => {
  it("watches up to three competitor sites and reports their new pages", async () => {
    const s = await setup("rival");
    await expect(addWatchedCompetitor(s.workspaceId, s.websiteId, { url: s.domain })).rejects.toThrow(/this website itself/);
    await expect(addWatchedCompetitor(s.workspaceId, s.websiteId, { url: "nodot" })).rejects.toThrow(CompetitorWatchError);
    const c = await addWatchedCompetitor(s.workspaceId, s.websiteId, { url: base, name: "Rival Co" });
    await expect(addWatchedCompetitor(s.workspaceId, s.websiteId, { url: base })).rejects.toThrow(/already watched/);
    const first = await checkCompetitorNow(s.workspaceId, c.id);
    expect(first.baseline).toBe(true);

    site.pages["/blog/new-offer"] = "Our new summer offer";
    site.pages["/services"] = "Services and prices";
    await checkCompetitorNow(s.workspaceId, c.id);
    const month = new Date().toISOString().slice(0, 7);
    const [a] = await competitorActivity(s.workspaceId, s.websiteId, month);
    expect(a.name).toBe("Rival Co");
    expect(a.newPages.map((p) => p.title)).toEqual(["Our new summer offer"]);
    expect(a.titleChanges).toEqual([expect.objectContaining({ before: "Services", after: "Services and prices" })]);
    // A competitor's pages never raise alerts for the client's website.
    expect(await db.siteAlert.count({ where: { websiteId: s.websiteId } })).toBe(0);
    await expect(removeWatchedCompetitor("other", c.id)).rejects.toThrow(CompetitorWatchError);
    await removeWatchedCompetitor(s.workspaceId, c.id);
    expect(await competitorActivity(s.workspaceId, s.websiteId, month)).toEqual([]);
    delete site.pages["/blog/new-offer"];
    site.pages["/services"] = "Services";
  }, 120_000);
});
