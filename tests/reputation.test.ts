import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { saveManualGbp } from "@/lib/research/service";
import { getProposalWithVersion, toRenderVersion, withImages } from "@/lib/proposals/service";
import { renderProposalHtml } from "@/lib/proposals/render";
import { ReputationError, addPastedReviews, addReviewScreenshot, checkReviews, createReputationProposal, reputationList, startReputationCase } from "@/lib/reputation";
import type { AiProvider } from "@/lib/ai/provider";

// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("reputation: bad reviews to proposal", () => {
  it("checks reviews, keeps screenshots and builds a reputation-only proposal", async () => {
    const user = await db.user.create({ data: { email: `rep${Date.now()}@test.example`, name: "R", passwordHash: "x" } });
    const ws = await createWorkspace("Rep WS", user.id);
    await expect(startReputationCase(ws.id, user.id, { link: "https://balloon.example/" })).rejects.toThrow(ReputationError);
    // Only the Google Maps link: the business name comes from it, no Places key needed.
    const link = "https://www.google.com/maps/place/Balloon+Co+Dubai/@25.1,55.2,15z";
    const saved = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = "";
    const { prospectId, note } = await startReputationCase(ws.id, user.id, { link });
    process.env.GOOGLE_PLACES_API_KEY = saved;
    expect(note).toMatch(/Places API/);
    const prospect = await db.prospect.findUniqueOrThrow({ where: { id: prospectId } });
    expect(prospect).toMatchObject({ businessName: "Balloon Co Dubai", domain: "maps/balloon-co-dubai" });
    expect((await startReputationCase(ws.id, user.id, { link })).prospectId).toBe(prospectId);
    // A profile link is never audited as a website.
    const { startAudit } = await import("@/lib/audit/service");
    await expect(startAudit(ws.id, user.id, { websiteUrl: prospect.websiteUrl, currency: "USD" })).rejects.toThrow(/Google Maps link/);

    await expect(createReputationProposal(ws.id, user.id, prospectId)).rejects.toThrow(/negative reviews/);
    // Screenshots are read by AI into the review list; pasted reviews are added too, without duplicates.
    const reader: AiProvider = {
      name: "fake",
      model: "fake",
      async generateJson({ schema, images }) {
        expect(images?.[0]?.mimeType).toBe("image/png");
        return schema.parse({ reviews: [{ rating: 1, text: "Fake! Go to SkyHigh instead.", author: "Ahmed K.", when: "2 weeks ago" }] });
      },
    };
    const first = await addReviewScreenshot(ws.id, prospectId, { type: "image/png", bytes: PNG }, undefined, reader);
    expect(first.read).toBe(1);
    expect((await addReviewScreenshot(ws.id, prospectId, { type: "image/png", bytes: PNG }, undefined, reader)).read).toBe(0);
    expect(await addPastedReviews(ws.id, prospectId, "2★ Late pickup.\n\n1★ Fake! Go to SkyHigh instead.")).toBe(1);
    await db.reviewScreenshot.deleteMany({ where: { prospectId } });

    await saveManualGbp(ws.id, user.id, prospectId, {
      name: "Balloon Co",
      rating: 3.6,
      reviewCount: 40,
      photoCount: 10,
      hasHours: true,
      hasWebsite: true,
      hasPhone: true,
      rankQuery: "balloon ride dubai",
      rankPosition: null,
      badReviewsText: "1★ Worst company, go to SkyHigh Balloons instead, they are better!\n\n2★ The pickup was an hour late and nobody called us.",
    });

    const fake: AiProvider = {
      name: "fake",
      model: "fake",
      async generateJson({ schema }) {
        return schema.parse({
          reviews: [
            { index: 0, verdict: "POLICY", policy: "Conflict of interest", reason: "Promotes a competitor and describes no visit.", reply: "We have no record of this booking." },
            { index: 1, verdict: "GENUINE", policy: null, reason: "A real complaint about a late pickup.", reply: "We are sorry about the delay — please call us." },
          ],
        });
      },
    };
    expect(await checkReviews(ws.id, prospectId, fake)).toEqual({ checked: 2, policy: 1 });

    await expect(addReviewScreenshot(ws.id, prospectId, { type: "application/pdf", bytes: PNG })).rejects.toThrow(/PNG, JPG or WebP/);
    await addReviewScreenshot(ws.id, prospectId, { type: "image/png", bytes: PNG }, "1-star review");

    const list = await reputationList(ws.id);
    expect(list[0]).toMatchObject({ negative: 2, policy: 1, checked: true, screenshots: 1 });

    const proposal = await createReputationProposal(ws.id, user.id, prospectId);
    const { version } = (await getProposalWithVersion(ws.id, proposal.id))!;
    expect(version.title).toBe("Reputation rescue plan for Balloon Co Dubai");
    expect(version.sections.filter((s) => s.included).map((s) => s.key)).toEqual(["executive_summary", "gbp", "reputation", "what_you_get", "why_us", "next_steps", "acceptance"]);
    const rep = version.sections.find((s) => s.key === "reputation")!;
    expect((rep.data as { reviews: { verdict: string }[] }).reviews.map((r) => r.verdict)).toEqual(["POLICY", "GENUINE"]);

    const html = renderProposalHtml(await withImages(toRenderVersion(version, proposal.title), ws.id), { businessName: "Balloon Co Dubai", websiteUrl: "https://balloon.example", contactName: null });
    expect(html).toContain("Breaks Google policy · Conflict of interest");
    expect(html).toContain("Genuine complaint");
    expect(html).toContain('<div class="rshots"><figure><img src="data:image/png;base64,');
    // No promise that every bad review disappears.
    expect(html).not.toMatch(/remove all|guarantee/i);
  });
});
