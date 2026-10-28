import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { createProposal, getProposalWithVersion, toRenderVersion } from "@/lib/proposals/service";
import { renderProposalHtml } from "@/lib/proposals/render";
import { translateProposal } from "@/lib/proposals/translate";
import { ProposalError } from "@/lib/proposals/service";
import type { AiProvider } from "@/lib/ai/provider";

// Stands in for Gemini: "translates" each text by prefixing Urdu words, and records what it was sent.
function fakeProvider(sent: string[]): AiProvider {
  return {
    name: "fake",
    model: "fake",
    async generateJson({ prompt, schema }) {
      sent.push(prompt);
      const { items } = JSON.parse(prompt.slice(prompt.indexOf("{"))) as { items: { id: string; text: string }[] };
      return schema.parse({ items: items.map((i) => ({ id: i.id, text: `ترجمہ: ${i.text}` })) });
    },
  };
}

describe("proposal translation", () => {
  it("saves an Urdu copy as a new version, keeps the English one, and renders right to left", async () => {
    const user = await db.user.create({ data: { email: `tr${Date.now()}@test.example`, name: "T", passwordHash: "x" } });
    const ws = await createWorkspace("Translate WS", user.id);
    const prospect = await createProspect(ws.id, user.id, { businessName: "Sand Tours", websiteUrl: `sand${Date.now()}.example`, currency: "AED", city: "Dubai" });
    const proposal = await createProposal(ws.id, user.id, { prospectId: prospect.id });
    const before = (await getProposalWithVersion(ws.id, proposal.id))!.version;

    await expect(translateProposal(ws.id, user.id, proposal.id, "ur")).rejects.toThrow(ProposalError);

    const sent: string[] = [];
    const r = await translateProposal(ws.id, user.id, proposal.id, "ur", fakeProvider(sent));
    expect(r.version).toBe(before.version + 1);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toContain("Urdu");

    const english = (await getProposalWithVersion(ws.id, proposal.id, before.version))!.version;
    expect(english.title).toBe(before.title);
    const urdu = (await getProposalWithVersion(ws.id, proposal.id))!.version;
    expect(urdu.title).toMatch(/^ترجمہ: /);
    expect(urdu.changeNote).toBe(`Translated to Urdu from v${before.version}`);
    expect(urdu.sections.length).toBe(before.sections.filter((s) => s.key !== "pricing").length);
    expect(urdu.sections.every((s) => !/[A-Za-z]{2}/.test(s.title) || s.title.startsWith("ترجمہ"))).toBe(true);

    const html = renderProposalHtml(toRenderVersion(urdu, proposal.title), { businessName: "Sand Tours", websiteUrl: "https://sand.example/", contactName: null });
    expect(html).toContain('<html lang="ur" dir="rtl">');
    const englishHtml = renderProposalHtml(toRenderVersion(english, proposal.title), { businessName: "Sand Tours", websiteUrl: "https://sand.example/", contactName: null });
    expect(englishHtml).toContain('<html lang="en" dir="ltr">');
  });
});
