import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { ReviewKitError, normalizeReviewLink, reviewMessages, setReviewLink } from "@/lib/review-kit";

describe("review kit", () => {
  it("accepts only Google review links and writes fair requests in three languages", async () => {
    expect(normalizeReviewLink("g.page/r/CabcXYZ/review")).toBe("https://g.page/r/CabcXYZ/review");
    expect(normalizeReviewLink("https://search.google.com/local/writereview?placeid=ChIJ123")).toContain("placeid=ChIJ123");
    expect(() => normalizeReviewLink("https://evil.example/review")).toThrow(ReviewKitError);

    const user = await db.user.create({ data: { email: `kit${Date.now()}@test.example`, name: "K", passwordHash: "x" } });
    const ws = await createWorkspace("Kit WS", user.id);
    const p = await createProspect(ws.id, user.id, { businessName: "Lahore Spice Kitchen", websiteUrl: `spice${Date.now()}.example`, currency: "PKR" });
    await setReviewLink(ws.id, user.id, p.id, "g.page/r/CabcXYZ/review");
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).reviewLink).toBe("https://g.page/r/CabcXYZ/review");
    await expect(setReviewLink("other-workspace", user.id, p.id, "g.page/r/x/review")).rejects.toThrow(/not found/);

    const msgs = reviewMessages("Lahore Spice Kitchen", "https://g.page/r/CabcXYZ/review");
    expect(msgs.map((m) => m.label)).toEqual(["English", "اردو (Urdu)", "العربية (Arabic)"]);
    for (const m of msgs) {
      expect(m.whatsapp).toContain("https://g.page/r/CabcXYZ/review");
      // No incentives and no "only if you were happy" wording (both break Google's review policy).
      expect(`${m.whatsapp} ${m.email.body}`).not.toMatch(/discount|free|coupon|only if|5[- ]star/i);
    }
  });
});
