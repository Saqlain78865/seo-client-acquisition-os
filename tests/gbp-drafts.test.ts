import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { ResearchError, saveManualGbp } from "@/lib/research/service";
import { draftGbpContent } from "@/lib/research/gbp-drafts";
import type { AiProvider } from "@/lib/ai/provider";

describe("Google Business Profile drafts", () => {
  it("drafts a reply per review and weekly posts, from the saved profile only", async () => {
    const user = await db.user.create({ data: { email: `gbpd${Date.now()}@test.example`, name: "D", passwordHash: "x" } });
    const ws = await createWorkspace("Drafts WS", user.id);
    const prospect = await createProspect(ws.id, user.id, { businessName: "Bright Smile Dental", websiteUrl: `brightd${Date.now()}.example`, currency: "GBP", city: "Leeds", primaryServices: "Dental implants" });
    const fake = (answer: unknown, seen: string[] = []): AiProvider => ({
      name: "fake",
      model: "fake",
      async generateJson({ prompt, schema }) {
        seen.push(prompt);
        return schema.parse(answer);
      },
    });

    await expect(draftGbpContent(ws.id, prospect.id, fake({ replies: [], posts: [] }))).rejects.toThrow(ResearchError);

    await saveManualGbp(ws.id, user.id, prospect.id, {
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
    const seen: string[] = [];
    const post = { title: "What happens at an implant consultation", body: "A calm first visit in Leeds…", button: "BOOK" };
    const drafts = await draftGbpContent(
      ws.id,
      prospect.id,
      fake({ replies: [{ index: 0, reply: "Sorry to hear this — please call us." }, { index: 1, reply: "Thank you for waiting." }, { index: 7, reply: "ghost" }], posts: [post, post, post, post, post] }, seen),
    );
    const sent = JSON.parse(seen[0]);
    expect(sent.business).toMatchObject({ name: "Bright Smile Dental", services: "Dental implants", area: "Leeds" });
    expect(sent.reviews.map((r: { text: string }) => r.text)).toEqual(["Never again.", "Long wait."]);
    // A reply for a review that does not exist is dropped; at most four posts.
    expect(drafts.replies).toEqual([
      { author: null, rating: 1, review: "Never again.", reply: "Sorry to hear this — please call us." },
      { author: null, rating: 2, review: "Long wait.", reply: "Thank you for waiting." },
    ]);
    expect(drafts.posts).toHaveLength(4);
  });
});
