import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { badReviews, fetchGbp, gbpIssues, GbpError, parsePastedReviews, type GbpData } from "@/lib/research/gbp";
import { fetchGbpProfile, ResearchError, saveManualGbp } from "@/lib/research/service";
import { createProposal, getProposalWithVersion, toRenderVersion, withImages } from "@/lib/proposals/service";
import { renderProposalHtml } from "@/lib/proposals/render";
import { ensureKickoff, kickoffTemplate, markWon, setKickoffTaskDone } from "@/lib/kickoff";
import { buildDigest, renderDigest } from "@/lib/digest";
import { pickScreenshotFindings } from "@/lib/audit/runner";
import { putFile } from "@/lib/storage";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup(name: string) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  const prospect = await createProspect(ws.id, user.id, { businessName: "Bright Smile Dental", websiteUrl: `brightsmile-${name}${Date.now()}.example`, currency: "USD", city: "Leeds", primaryServices: "Dental implants" });
  return { userId: user.id, workspaceId: ws.id, prospect };
}

const base: GbpData = {
  source: "PLACES_API",
  placeId: "p1",
  name: "Bright Smile Dental",
  address: "1 Main St, Leeds",
  phone: null,
  website: "https://other-site.example/",
  mapsUrl: null,
  category: "Dentist",
  rating: 3.8,
  reviewCount: 7,
  photoCount: 3,
  hasHours: false,
  hasDescription: false,
  businessStatus: "OPERATIONAL",
  reviews: [
    { rating: 1, text: "Waited an hour.", author: "A", when: "a week ago" },
    { rating: 5, text: "Great!", author: "B", when: null },
  ],
  rankings: [
    { query: "dentist leeds", position: null, total: 20, checkedAt: "2026-10-22" },
    { query: "dental implants leeds", position: 6, total: 20, checkedAt: "2026-10-22" },
  ],
};

describe("Google Business Profile", () => {
  it("finds profile issues only from the data it has", () => {
    const keys = gbpIssues(base, "brightsmile.example").map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["website", "rating", "reviews", "photos", "hours", "phone", "rank:dentist leeds", "rank:dental implants leeds"]));
    expect(gbpIssues(base, "brightsmile.example")[0].severity).toBe("HIGH");
    const healthy: GbpData = { ...base, phone: "+44", website: "https://brightsmile.example/", rating: 4.8, reviewCount: 240, photoCount: 10, hasHours: true, rankings: [{ query: "dentist leeds", position: 2, total: 20, checkedAt: "x" }] };
    expect(gbpIssues(healthy, "brightsmile.example")).toEqual([]);
    const unknown: GbpData = { ...base, rating: null, reviewCount: null, photoCount: null, hasHours: null, phone: "unknown", website: "https://brightsmile.example", rankings: [] };
    expect(gbpIssues(unknown, "brightsmile.example")).toEqual([]);
    expect(badReviews(base).map((r) => r.text)).toEqual(["Waited an hour."]);
  });

  it("parses pasted reviews with their stars", () => {
    expect(parsePastedReviews("2★ Slow service.\n\n3/5 - Okay but late\n\nRude staff")).toEqual([
      { rating: 2, text: "Slow service.", author: null, when: null },
      { rating: 3, text: "Okay but late", author: null, when: null },
      { rating: 1, text: "Rude staff", author: null, when: null },
    ]);
  });

  it("fetches the profile matched by website and its Maps positions through the Places API", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith("/places:searchText")) {
        const body = JSON.parse(String(init?.body)) as { textQuery: string };
        if (body.textQuery === "dentist leeds") return json({ places: [{ id: "x" }, { id: "x2" }, { id: "p1" }] });
        return json({ places: [{ id: "other", displayName: { text: "Other" }, websiteUri: "https://other.example" }, { id: "p1", displayName: { text: "Bright Smile" }, websiteUri: "https://www.brightsmile.example/" }] });
      }
      return json({
        id: "p1",
        displayName: { text: "Bright Smile Dental" },
        rating: 4.2,
        userRatingCount: 31,
        photos: [{}, {}],
        regularOpeningHours: {},
        websiteUri: "https://brightsmile.example",
        reviews: [{ rating: 2, originalText: { text: "Too slow" }, authorAttribution: { displayName: "Z" }, relativePublishTimeDescription: "2 months ago" }],
      });
    }) as typeof fetch;
    const g = await fetchGbp("KEY", { businessName: "Bright Smile Dental", domain: "brightsmile.example", city: "Leeds", queries: ["dentist leeds"] }, fake);
    expect(g.placeId).toBe("p1");
    expect(g.rating).toBe(4.2);
    expect(g.reviews).toEqual([{ rating: 2, text: "Too slow", author: "Z", when: "2 months ago" }]);
    expect(g.rankings[0]).toMatchObject({ query: "dentist leeds", position: 3, total: 3 });
    expect(calls.some((c) => c.startsWith("GET https://places.googleapis.com/v1/places/p1"))).toBe(true);

    const disabled = (async () => json({ error: { message: "Places API (New) has not been used in project 1 before or it is disabled." } }, 403)) as typeof fetch;
    await expect(fetchGbp("KEY", { businessName: "X", domain: "x.example", city: null, queries: [] }, disabled)).rejects.toMatchObject({ code: "NOT_ENABLED" });
    const none = (async () => json({ places: [] })) as typeof fetch;
    await expect(fetchGbp("KEY", { businessName: "X", domain: "x.example", city: null, queries: [] }, none)).rejects.toThrow(GbpError);
  });

  it("puts the profile and its bad reviews into the proposal, with reputation management", async () => {
    const { userId, workspaceId, prospect } = await setup("gbp");
    const saved = [process.env.GOOGLE_PLACES_API_KEY, process.env.PAGESPEED_API_KEY];
    process.env.GOOGLE_PLACES_API_KEY = "";
    process.env.PAGESPEED_API_KEY = "";
    try {
      await expect(fetchGbpProfile(workspaceId, userId, prospect.id)).rejects.toThrow(ResearchError);
    } finally {
      [process.env.GOOGLE_PLACES_API_KEY, process.env.PAGESPEED_API_KEY] = saved;
    }
    await saveManualGbp(workspaceId, userId, prospect.id, {
      name: "Bright Smile Dental",
      rating: 3.9,
      reviewCount: 12,
      photoCount: 4,
      hasHours: false,
      hasWebsite: true,
      hasPhone: null,
      rankQuery: "dentist leeds",
      rankPosition: null,
      badReviewsText: "1★ Never again.\n\n2★ Long wait.",
    });
    const proposal = await createProposal(workspaceId, userId, { prospectId: prospect.id });
    const found = (await getProposalWithVersion(workspaceId, proposal.id))!;
    expect(found.version.services as string[]).toEqual(expect.arrayContaining(["LOCAL", "REPUTATION"]));
    expect(found.version.sections.find((s) => s.key === "gbp")!.included).toBe(true);
    const html = renderProposalHtml(toRenderVersion(found.version, found.proposal.title), { businessName: "Bright Smile Dental", websiteUrl: prospect.websiteUrl, contactName: null });
    expect(html).toContain("3.9");
    expect(html).toContain("Not in top 20");
    expect(html).toContain("Never again.");
    expect(html).toContain("Brand Reputation Management");
    expect(html).toContain("Genuine reviews cannot be deleted by anyone");
  });
});

describe("screenshots in proposals", () => {
  it("picks visual, high-priority findings and loads only this workspace's images", async () => {
    const f = (ruleId: string, severity: string, priority: number) =>
      ({ ruleId, severity, priority, evidenceStatus: "CONFIRMED", affectedUrls: ["https://x.example/"] }) as unknown as Parameters<typeof pickScreenshotFindings>[0][number];
    const picked = pickScreenshotFindings([f("onpage.title-long", "HIGH", 90), f("onpage.image-alt-missing", "MEDIUM", 50), f("tech.redirect-chains", "MEDIUM", 60), f("cro.no-click-to-call-home", "MEDIUM", 40), f("onpage.h1-missing", "LOW", 99)]);
    expect(picked.map((p) => p.ruleId)).toEqual(["onpage.image-alt-missing", "cro.no-click-to-call-home", "onpage.title-long"]);

    const { workspaceId } = await setup("shots");
    const mine = `screenshots/${workspaceId}/a1/0-homepage_desktop.jpg`;
    await putFile(mine, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const rv = await withImages(
      { sections: [{ key: "audit_overview", title: "", body: "", included: true, data: { screens: { desktop: mine, mobile: "screenshots/OTHER/a/1.jpg" } } }] } as unknown as ReturnType<typeof toRenderVersion>,
      workspaceId,
    );
    expect(Object.keys(rv.images!)).toEqual([mine]);
    expect(rv.images![mine]).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe("won deals and kickoff", () => {
  it("builds the checklist from the services and keeps it once created", async () => {
    const t = kickoffTemplate(["TECHNICAL", "LOCAL", "REPUTATION", "KEYWORDS"], ["Fix broken links", "Add titles", "Speed", "Extra"]);
    const titles = t.map((x) => x.title).join("\n");
    expect(titles).toMatch(/Google Business Profile/);
    expect(titles).toMatch(/review request/);
    expect(titles).toMatch(/First fix: Fix broken links/);
    expect(titles).not.toMatch(/Extra/);

    const { workspaceId, prospect } = await setup("won");
    const { deal, kickoffCreated } = await markWon(workspaceId, prospect.id, { reason: "test" });
    expect(deal.stage).toBe("WON");
    expect(kickoffCreated).toBeGreaterThan(5);
    expect((await ensureKickoff(workspaceId, prospect.id)).created).toBe(0);
    const again = await markWon(workspaceId, prospect.id, { reason: "again" });
    expect(again.deal.id).toBe(deal.id);
    expect(await db.deal.count({ where: { prospectId: prospect.id } })).toBe(1);
    const task = await db.kickoffTask.findFirstOrThrow({ where: { prospectId: prospect.id } });
    expect((await setKickoffTaskDone(workspaceId, task.id, true))!.doneAt).not.toBeNull();
    expect(await setKickoffTaskDone("someone-else", task.id, true)).toBeNull();
  });
});

describe("weekly summary", () => {
  it("counts the week's proposal activity and lists who needs a follow-up", async () => {
    const { userId, workspaceId, prospect } = await setup("digest");
    const proposal = await createProposal(workspaceId, userId, { prospectId: prospect.id });
    const now = new Date();
    await db.proposal.update({ where: { id: proposal.id }, data: { status: "SENT", shareViews: 2, shareLastViewedAt: new Date(now.getTime() - 3 * 86_400_000) } });
    await db.followUp.create({ data: { workspaceId, prospectId: prospect.id, proposalId: proposal.id, type: "OPENED_NO_REPLY", dueAt: new Date(now.getTime() - 3600_000) } });
    const d = await buildDigest(workspaceId, now);
    expect(d.opened.map((o) => o.name)).toEqual(["Bright Smile Dental"]);
    expect(d.nudges.map((n) => n.id)).toEqual([proposal.id]);
    expect(d.due[0]).toMatchObject({ name: "Bright Smile Dental", overdue: true });
    const mail = renderDigest(d, "Nova <SEO>", "https://app.example");
    expect(mail.subject).toBe("Your week: 1 proposal opened, 0 accepted · 1 follow-up to do");
    expect(mail.text).toContain(`https://app.example/proposals/${proposal.id}/send?followup=1`);
    expect(mail.html).toContain("Nova &lt;SEO&gt;");
    expect(mail.html).not.toContain("Nova <SEO>");
  });
});
