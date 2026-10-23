import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { contrastOnWhite, paletteFromColor, resolvePalette, THEME_KEYS } from "@/lib/proposals/theme";
import { THEMES } from "@/lib/proposals/types";
import { renderProposalHtml } from "@/lib/proposals/render";
import { createProposal, currentBranding, getProposalWithVersion, proposalKeywords, toRenderVersion, versionPayloadSchema } from "@/lib/proposals/service";
import { cleanIdeas } from "@/lib/research/ai-keywords";
import { addManualKeywords, chooseTopKeywords, generateAiKeywordIdeas, ResearchError, setKeywordInProposal } from "@/lib/research/service";
import { followUpDraft } from "@/lib/messaging/followup";
import { AiError, type AiProvider } from "@/lib/ai/provider";

describe("proposal themes and brand colour", () => {
  it("derives a readable palette from any brand colour", () => {
    for (const c of ["#e11d48", "#facc15", "#a3e635", "#ffffff", "#0ea5e9"]) {
      const p = paletteFromColor(c);
      expect(contrastOnWhite(p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastOnWhite(p.dark)).toBeGreaterThan(10); // white cover text stays readable
      expect(p.soft).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Already dark enough: kept as it is.
    expect(paletteFromColor("#1D4ED8").primary).toBe("#1d4ed8");
  });

  it("resolves presets, the brand theme, and falls back safely", () => {
    expect(resolvePalette("teal", null)).toEqual(THEMES.teal);
    expect(resolvePalette("brand", "#e11d48").primary).toBe(paletteFromColor("#e11d48").primary);
    expect(resolvePalette("brand", null)).toEqual(THEMES.navy);
    expect(resolvePalette("brand", "red; } body { display:none")).toEqual(THEMES.navy);
    expect(resolvePalette("unknown", "#e11d48")).toEqual(THEMES.navy);
    expect(THEME_KEYS).toContain("brand");
    expect(THEME_KEYS).toContain("gold");
  });

  it("uses the workspace brand colour in new proposals", async () => {
    const user = await db.user.create({ data: { email: `brand${Date.now()}@test.example`, name: "Brand", passwordHash: "x" } });
    const ws = await createWorkspace("Brand WS", user.id);
    await db.workspaceSettings.update({ where: { workspaceId: ws.id }, data: { brandColor: "#e11d48", proposalTheme: "brand", companyName: "Rose Digital" } });
    expect((await currentBranding(ws.id)).brandColor).toBe("#e11d48");
    const prospect = await createProspect(ws.id, user.id, { businessName: "Client", websiteUrl: "client-brand.example", currency: "USD" });
    const proposal = await createProposal(ws.id, user.id, { prospectId: prospect.id });
    const found = (await getProposalWithVersion(ws.id, proposal.id))!;
    expect(found.version.theme).toBe("brand");
    const html = renderProposalHtml(toRenderVersion(found.version, found.proposal.title), { businessName: "Client", websiteUrl: "https://client-brand.example", contactName: null });
    expect(html).toContain(`--primary: ${paletteFromColor("#e11d48").primary}`);
  });
});

describe("AI keyword ideas", () => {
  it("cleans, de-duplicates and filters model output", () => {
    const out = cleanIdeas(
      [
        { keyword: "  Dental Implants   Leeds ", intent: "TRANSACTIONAL", reason: "Ready to book." },
        { keyword: "dental implants leeds", intent: "TRANSACTIONAL", reason: "dup" },
        { keyword: "teeth whitening", intent: "COMMERCIAL", reason: "already have" },
        { keyword: "visit https://spam.example", intent: "NAVIGATIONAL", reason: "" },
        { keyword: "ab", intent: "INFORMATIONAL", reason: "" },
        { keyword: '"how much do implants cost"', intent: "INFORMATIONAL", reason: "Cost research." },
      ],
      ["Teeth Whitening"],
    );
    expect(out.map((i) => i.keyword)).toEqual(["dental implants leeds", "how much do implants cost"]);
  });

  it("saves ideas as metric-free keywords with reasons, and reports AI errors plainly", async () => {
    const user = await db.user.create({ data: { email: `kw${Date.now()}@test.example`, name: "Kw", passwordHash: "x" } });
    const ws = await createWorkspace("Kw WS", user.id);
    const prospect = await createProspect(ws.id, user.id, { businessName: "Bright Smile", websiteUrl: "brightsmile-kw.example", currency: "USD", city: "Leeds", primaryServices: "Dental implants, Teeth whitening" });
    let prompt = "";
    const fake: AiProvider = {
      name: "Fake AI",
      model: "fake-1",
      async generateJson<T>({ prompt: p, schema }: { prompt: string; schema: z.ZodType<T> }) {
        prompt = p;
        return schema.parse({
          ideas: [
            { keyword: "dental implants leeds", intent: "TRANSACTIONAL", reason: "People ready to book implants locally." },
            { keyword: "how long do dental implants last", intent: "INFORMATIONAL", reason: "Research before buying." },
          ],
        });
      },
    };
    const r = await generateAiKeywordIdeas(ws.id, prospect.id, fake);
    expect(r.created).toBe(2);
    expect(prompt).toContain("Dental implants");
    expect(prompt).toContain("Leeds");
    const saved = await db.keyword.findMany({ where: { prospectId: prospect.id }, orderBy: { keyword: "asc" } });
    expect(saved.map((k) => k.keyword)).toEqual(["dental implants leeds", "how long do dental implants last"]);
    for (const k of saved) {
      expect(k.searchVolume).toBeNull();
      expect(k.isSeed).toBe(true);
      expect(k.dataSource).toMatch(/AI idea .* no search data/);
      expect(k.note).toBeTruthy();
      expect(k.clusterId).not.toBeNull();
    }
    // Running it again adds nothing already present.
    expect((await generateAiKeywordIdeas(ws.id, prospect.id, fake)).created).toBe(0);

    const failing: AiProvider = { name: "Fake", model: "x", generateJson: async () => { throw new AiError("Gemini rate limit reached. Try again later.", "RATE_LIMITED"); } };
    await expect(generateAiKeywordIdeas(ws.id, prospect.id, failing)).rejects.toThrow(ResearchError);
    const other = await createWorkspace("Other Kw", user.id);
    await expect(generateAiKeywordIdeas(other.id, prospect.id, fake)).rejects.toThrow("Prospect not found");
  });

  it("asks for a free Gemini key when none is configured", async () => {
    const user = await db.user.create({ data: { email: `kw2${Date.now()}@test.example`, name: "Kw", passwordHash: "x" } });
    const ws = await createWorkspace("Kw2 WS", user.id);
    const prospect = await createProspect(ws.id, user.id, { businessName: "X", websiteUrl: "x-kw.example", currency: "USD", primaryServices: "Plumbing" });
    const saved = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "";
    try {
      await expect(generateAiKeywordIdeas(ws.id, prospect.id)).rejects.toThrow(/Gemini API key/);
    } finally {
      process.env.GEMINI_API_KEY = saved;
    }
  });
});

describe("keywords in the proposal", () => {
  it("uses chosen keywords (or the top ones) as a table of target searches", async () => {
    const user = await db.user.create({ data: { email: `kwp${Date.now()}@test.example`, name: "Kwp", passwordHash: "x" } });
    const ws = await createWorkspace("Kwp WS", user.id);
    const prospect = await createProspect(ws.id, user.id, { businessName: "Leeds Dental", websiteUrl: "leedsdental-kwp.example", currency: "USD", city: "Leeds", primaryServices: "Dental implants" });

    // No keywords at all: the section keeps its plan text and has no table.
    const empty = (await getProposalWithVersion(ws.id, (await createProposal(ws.id, user.id, { prospectId: prospect.id })).id))!;
    expect(empty.version.sections.find((s) => s.key === "keywords")?.data).toBeNull();

    await addManualKeywords(ws.id, prospect.id, ["dental implants leeds", "emergency dentist leeds", "leeds dental login", "how long do implants last"]);
    await db.keyword.updateMany({ where: { prospectId: prospect.id, keyword: "dental implants leeds" }, data: { searchVolume: 1300, volumeIsEstimate: true } });

    // Nothing chosen yet: the top keywords by priority are used, brand/navigation searches skipped.
    const auto = await proposalKeywords(ws.id, prospect.id);
    expect(auto.chosen).toBe(false);
    expect(auto.keywords.map((k) => k.keyword)).not.toContain("leeds dental login");

    expect(await chooseTopKeywords(ws.id, prospect.id, 2)).toBe(2);
    const dental = await db.keyword.findFirstOrThrow({ where: { prospectId: prospect.id, keyword: "how long do implants last" } });
    await setKeywordInProposal(ws.id, prospect.id, dental.id, true);
    const chosen = await proposalKeywords(ws.id, prospect.id);
    expect(chosen.chosen).toBe(true);
    expect(chosen.keywords).toHaveLength(3);
    await expect(setKeywordInProposal("other-ws", prospect.id, dental.id, false)).rejects.toThrow(ResearchError);

    const proposal = await createProposal(ws.id, user.id, { prospectId: prospect.id });
    const found = (await getProposalWithVersion(ws.id, proposal.id))!;
    const section = found.version.sections.find((s) => s.key === "keywords")!;
    expect(section.included).toBe(true);
    expect((section.data as { keywords: unknown[] }).keywords).toHaveLength(3);
    const html = renderProposalHtml(toRenderVersion(found.version, found.proposal.title), { businessName: "Leeds Dental", websiteUrl: "https://leedsdental-kwp.example", contactName: null });
    expect(html).toContain("Monthly searches");
    expect(html).toContain("1,300");
    expect(html).toContain("To be measured");
    expect(html).toContain("how long do implants last");

    // The editor can save the keyword list (validated), and clearing the choice works.
    expect(versionPayloadSchema.shape.sections.element.shape.data.safeParse({ keywords: chosen.keywords }).success).toBe(true);
    expect(await chooseTopKeywords(ws.id, prospect.id, 0)).toBe(0);
    expect(await db.keyword.count({ where: { prospectId: prospect.id, inProposal: true } })).toBe(0);
  });
});

describe("follow-up draft", () => {
  it("offers help without mentioning that the proposal was opened", () => {
    const d = followUpDraft({ firstName: "Sara", businessName: "Bright Smile", sentOn: "20 October", shareLink: "https://app.example/p/abc", findingsSummary: "I found 4 specific improvements, including slow pages.", consultantName: "Ali", companyName: "Nova SEO" });
    expect(d.subject).toBe("Quick follow-up: SEO proposal for Bright Smile");
    expect(d.email).toMatch(/^Hi Sara,/);
    expect(d.email).toContain("sent on 20 October for Bright Smile");
    expect(d.email).toContain("As a quick reminder: I found 4 specific improvements");
    expect(d.email).toContain("https://app.example/p/abc");
    expect(d.email).toMatch(/Best regards,\nAli\nNova SEO$/);
    expect(d.email + d.whatsapp).not.toMatch(/opened|viewed|noticed/i);
    const bare = followUpDraft({ firstName: null, businessName: "X", sentOn: null, shareLink: null, findingsSummary: "", consultantName: null, companyName: null });
    expect(bare.email).toMatch(/^Hi there,/);
    expect(bare.email).not.toContain("undefined");
    expect(bare.whatsapp).not.toContain("null");
  });
});
