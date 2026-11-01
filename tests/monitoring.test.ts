import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { saveCredentials } from "@/lib/integrations";
import { createWebsite } from "@/lib/websites";
import { runnerOptions } from "@/lib/audit/runner";
import { MAX_KEYWORDS, RankError, addKeywords, exactAny, removeKeyword, syncPositions, trackedKeywords, weekMove } from "@/lib/rank-tracking";
import { checkTraffic, checkUptime, raiseAlert, resolveAlert } from "@/lib/site-alerts";
import { ReportDeliveryError, cancelReport, readReportLink, runReportSchedules, saveReportSchedule, signReportLink } from "@/lib/report-delivery";
import { suggestLinks, topicsOf } from "@/lib/internal-links";

async function site(name: string, linked = true) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  const w = await createWebsite(ws.id, user.id, { name: "Sky", url: `https://${name}${Date.now()}.example/`, kind: "CLIENT" });
  if (linked) {
    await db.website.update({ where: { id: w.id }, data: { gscSiteUrl: `sc-domain:${w.domain}` } });
    await saveCredentials(ws.id, "GOOGLE_OAUTH_APP", { secret: { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" } });
    await saveCredentials(ws.id, "SEARCH_CONSOLE", { secret: { refreshToken: "r" }, accountLabel: "me@example.com" });
  }
  return { workspaceId: ws.id, userId: user.id, websiteId: w.id, domain: w.domain };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

describe("keyword rank tracking", () => {
  it("adds up to 50 keywords per website, cleaned and without duplicates", async () => {
    const s = await site("kw", false);
    expect(await addKeywords(s.workspaceId, s.websiteId, "Pad Thai NYC,  pad thai nyc\nthai food")).toBe(2);
    expect(await addKeywords(s.workspaceId, s.websiteId, "thai food")).toBe(0);
    await expect(addKeywords(s.workspaceId, s.websiteId, Array.from({ length: MAX_KEYWORDS }, (_, i) => `kw ${i}`).join("\n"))).rejects.toThrow(RankError);
    await expect(addKeywords("other", s.websiteId, "x y")).rejects.toThrow(/not found/);
    const list = await trackedKeywords(s.workspaceId, s.websiteId);
    expect(list.map((k) => k.keyword)).toEqual(["pad thai nyc", "thai food"]);
    await expect(removeKeyword("other", list[0].id)).rejects.toThrow(RankError);
    await removeKeyword(s.workspaceId, list[0].id);
    expect(await trackedKeywords(s.workspaceId, s.websiteId)).toHaveLength(1);
  });

  it("matches keywords exactly in Search Console", () => {
    expect(exactAny(["pad thai", "c++ (nyc)"])).toBe("^(?:pad thai|c\\+\\+ \\(nyc\\))$");
    expect(weekMove([...Array.from({ length: 7 }, (_, i) => ({ date: day("2026-10-01", i), position: 4 })), ...Array.from({ length: 7 }, (_, i) => ({ date: day("2026-10-08", i), position: 9 }))])).toEqual({ now: 9, before: 4, change: -5 });
  });

  it("stores daily positions from Search Console and alerts on a drop once", async () => {
    const s = await site("rank");
    await addKeywords(s.workspaceId, s.websiteId, "balloon ride, sunrise flight");
    const now = new Date("2026-10-20T10:00:00Z");
    let body: { dimensions: string[]; dimensionFilterGroups: { filters: { operator: string; expression: string }[] }[]; startDate: string; endDate: string } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "t", expires_in: 3600 });
      body = JSON.parse(String(init?.body));
      // "balloon ride": position 3 for the first days, 8 for the last ones; "sunrise flight" never shown.
      const rows = [];
      for (let i = 0; i < 10; i++) rows.push({ keys: ["balloon ride", day(body!.startDate, i)], clicks: 2, impressions: 40, ctr: 0.05, position: i < 3 ? 3 : 8 });
      return json({ rows });
    }) as unknown as typeof fetch;
    // Two syncs a week apart give 14 stored days.
    await syncPositions(s.workspaceId, s.websiteId, fake, new Date(now.getTime() - 7 * 86400_000));
    await syncPositions(s.workspaceId, s.websiteId, fake, now);
    expect(body!.dimensions).toEqual(["query", "date"]);
    expect(body!.dimensionFilterGroups[0].filters[0]).toMatchObject({ operator: "includingRegex", expression: "^(?:balloon ride|sunrise flight)$" });
    const list = await trackedKeywords(s.workspaceId, s.websiteId);
    const balloon = list.find((k) => k.keyword === "balloon ride")!;
    expect(balloon.latest?.position).toBe(8);
    expect(list.find((k) => k.keyword === "sunrise flight")!.latest).toBeNull();
    const alerts = await db.siteAlert.findMany({ where: { websiteId: s.websiteId, kind: "RANK_DROP" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/“balloon ride” fell from/);
    await syncPositions(s.workspaceId, s.websiteId, fake, now);
    expect(await db.siteAlert.count({ where: { websiteId: s.websiteId, kind: "RANK_DROP" } })).toBe(1);
    expect(await db.notification.count({ where: { workspaceId: s.workspaceId, title: { contains: "balloon ride" } } })).toBe(1);
  });
});

describe("alerts", () => {
  it("raises an alert once and lets it be resolved", async () => {
    const s = await site("al", false);
    expect(await raiseAlert(s.workspaceId, s.websiteId, { kind: "PAGE_GONE", dedupeKey: "gone:/a", title: "A page returns 404" })).toBe(true);
    expect(await raiseAlert(s.workspaceId, s.websiteId, { kind: "PAGE_GONE", dedupeKey: "gone:/a", title: "A page returns 404" })).toBe(false);
    const a = await db.siteAlert.findFirstOrThrow({ where: { websiteId: s.websiteId } });
    expect(await resolveAlert("other", a.id)).toBe(false);
    expect(await resolveAlert(s.workspaceId, a.id)).toBe(true);
  });

  it("alerts on a sudden fall in Google clicks, not on a small dip", async () => {
    const s = await site("traffic");
    const make = (recent: number) =>
      (async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "t", expires_in: 3600 });
        const b = JSON.parse(String(init?.body));
        return json({ rows: Array.from({ length: 14 }, (_, i) => ({ keys: [day(b.startDate, i)], clicks: i < 7 ? 10 : recent, impressions: 100, ctr: 0.1, position: 5 })) });
      }) as unknown as typeof fetch;
    const now = new Date("2026-10-20T10:00:00Z");
    expect((await checkTraffic(s.workspaceId, s.websiteId, make(8), now)).drop).toBeCloseTo(0.2);
    expect(await db.siteAlert.count({ where: { websiteId: s.websiteId } })).toBe(0);
    const r = await checkTraffic(s.workspaceId, s.websiteId, make(3), now);
    expect(r).toMatchObject({ before: 70, recent: 21 });
    const alert = await db.siteAlert.findFirstOrThrow({ where: { websiteId: s.websiteId } });
    expect(alert.title).toBe("Clicks from Google fell 70% (70 → 21)");
  });

  describe("uptime", () => {
    let server: http.Server;
    let failing = true;
    let base = "";
    beforeAll(async () => {
      server = http.createServer((_, res) => {
        res.writeHead(failing ? 503 : 200, { "content-type": "text/html" });
        res.end("<html><body>ok</body></html>");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      runnerOptions.allowPrivateNetworks = true;
    });
    afterAll(() => {
      runnerOptions.allowPrivateNetworks = false;
      server.close();
    });

    it("calls the site down after two failed checks and closes the alert when it is back", async () => {
      const s = await site("up", false);
      await db.website.update({ where: { id: s.websiteId }, data: { url: base } });
      expect(await checkUptime(s.workspaceId, s.websiteId)).toBe("UP");
      expect(await checkUptime(s.workspaceId, s.websiteId)).toBe("DOWN");
      expect(await checkUptime(s.workspaceId, s.websiteId)).toBe("DOWN");
      expect(await db.siteAlert.count({ where: { websiteId: s.websiteId, kind: "SITE_DOWN", resolvedAt: null } })).toBe(1);
      failing = false;
      expect(await checkUptime(s.workspaceId, s.websiteId)).toBe("UP");
      expect(await db.siteAlert.count({ where: { websiteId: s.websiteId, kind: "SITE_DOWN", resolvedAt: null } })).toBe(0);
      expect(await db.notification.count({ where: { workspaceId: s.workspaceId, title: { contains: "back up" } } })).toBe(1);
    }, 30_000);
  });
});

describe("monthly report email", () => {
  it("validates the schedule and prepares last month's report on the client's day, once", async () => {
    const s = await site("rep", false);
    await expect(saveReportSchedule(s.workspaceId, s.websiteId, { day: 31, email: "a@b.co", approval: true })).rejects.toThrow(ReportDeliveryError);
    await expect(saveReportSchedule(s.workspaceId, s.websiteId, { day: 2, email: "not-an-email", approval: true })).rejects.toThrow(/look right/);
    await expect(saveReportSchedule(s.workspaceId, s.websiteId, { day: 2, email: null, approval: true })).rejects.toThrow(/email/);
    await saveReportSchedule(s.workspaceId, s.websiteId, { day: 5, email: "Client@Example.com", approval: true });

    await runReportSchedules(new Date(2026, 10, 4, 12));
    expect(await db.reportDelivery.count({ where: { websiteId: s.websiteId } })).toBe(0);
    await runReportSchedules(new Date(2026, 10, 5, 12));
    await runReportSchedules(new Date(2026, 10, 6, 12));
    const list = await db.reportDelivery.findMany({ where: { websiteId: s.websiteId } });
    expect(list.map((d) => [d.month, d.to, d.status])).toEqual([["2026-10", "client@example.com", "AWAITING_APPROVAL"]]);
    expect(await db.notification.count({ where: { workspaceId: s.workspaceId, title: { contains: "ready to send" } } })).toBe(1);
    await cancelReport(s.workspaceId, list[0].id);
    await expect(cancelReport(s.workspaceId, list[0].id)).rejects.toThrow(ReportDeliveryError);
  });

  it("signs a short-lived print link for exactly one report", () => {
    const t = signReportLink("ws1", "site1", "2026-10");
    expect(readReportLink(t)).toEqual({ workspaceId: "ws1", websiteId: "site1", month: "2026-10" });
    expect(readReportLink(signReportLink("ws1", "site2", "2026-10").split(".")[0] + "." + t.split(".")[1])).toBeNull();
    expect(readReportLink(signReportLink("ws1", "site1", "2026-10", -1))).toBeNull();
  });
});

describe("internal linking suggestions", () => {
  const page = (url: string, title: string, text: string, links: string[] = []) => ({ url: `https://x.example${url}`, title, h1: null, text, links: links.map((l) => `https://x.example${l}`) });

  it("suggests linking mentions of another page's topic, skipping existing links", () => {
    const pages = [
      page("/", "Zoob Zib | Thai food NYC", "Welcome. Try our pad thai and mango sticky rice today.", ["/menu"]),
      page("/pad-thai", "Pad Thai | Zoob Zib", "Our pad thai is cooked to order with fresh noodles and tamarind sauce.", ["/"]),
      page("/mango-sticky-rice", "Mango Sticky Rice - Zoob Zib", "A sweet dessert. It goes well after a plate of pad thai.", ["/"]),
      page("/menu", "Menu", "Everything we cook, from pad thai to mango sticky rice.", ["/pad-thai"]),
    ];
    expect(topicsOf(pages[1])).toEqual(["pad thai"]);
    const r = suggestLinks(pages);
    const pairs = r.suggestions.map((s) => `${s.source.replace("https://x.example", "")} → ${s.target.replace("https://x.example", "")} (${s.anchor})`);
    expect(pairs).toContain("/ → /mango-sticky-rice (mango sticky rice)");
    expect(pairs).toContain("/mango-sticky-rice → /pad-thai (pad thai)");
    // /menu already links to /pad-thai.
    expect(pairs).not.toContain("/menu → /pad-thai (pad thai)");
    expect(r.orphans).toEqual(["https://x.example/mango-sticky-rice"]);
    // Search Console searches of a page are used as its topics first.
    const withGsc = suggestLinks(pages, new Map([["https://x.example/menu", ["thai food nyc"]]]));
    expect(withGsc.suggestions.some((s) => s.target.endsWith("/menu") && s.anchor === "thai food nyc")).toBe(false);
  });
});
