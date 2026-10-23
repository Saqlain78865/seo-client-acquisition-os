import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { runnerOptions } from "@/lib/audit/runner";
import { startAudit } from "@/lib/audit/service";
import { escapeHtml, renderProposalHtml, renderText } from "@/lib/proposals/render";
import {
  createProposal,
  duplicateProposal,
  ensurePdf,
  getProposalWithVersion,
  pdfFileName,
  ProposalError,
  saveProposalVersion,
  toRenderVersion,
  versionPayloadSchema,
  type VersionPayload,
} from "@/lib/proposals/service";
import type { ProposalFinding } from "@/lib/proposals/types";
import { startFixtureSite } from "./fixtures/site";

describe("safe rendering", () => {
  it("escapes HTML and only links http(s) URLs", () => {
    const html = renderText('<script>alert(1)</script> **bold** see https://example.com/a.\n\n- one\n- javascript:alert(1)');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com/a">https://example.com/a</a>.');
    expect(html).toContain("<li>javascript:alert(1)</li>");
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
  it("makes safe PDF file names", () => {
    expect(pdfFileName('Café "Lahore" / Grill', 2)).toBe("SEO-Proposal-Cafe-Lahore-Grill-v2.pdf");
  });
});

describe("proposal lifecycle", () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let workspaceId: string;
  let userId: string;
  let prospectId: string;
  let auditId: string;
  let proposalId: string;

  beforeAll(async () => {
    runnerOptions.allowPrivateNetworks = true;
    site = await startFixtureSite();
    const user = await db.user.create({ data: { email: `prop${Date.now()}@test.example`, name: "Prop", passwordHash: "x" } });
    userId = user.id;
    workspaceId = (await createWorkspace("Proposal WS", user.id)).id;
    await db.workspaceSettings.update({ where: { workspaceId }, data: { crawlDelayMs: 250, companyName: "Nova SEO Studio", consultantName: "Saqlain", companyEmail: "hello@nova.example" } });
    const { audit, prospect } = await startAudit(workspaceId, userId, { websiteUrl: site.base, currency: "GBP", targetCity: "Leeds", primaryService: "Dental implants" });
    auditId = audit.id;
    prospectId = prospect.id;
    for (let i = 0; i < 300; i++) {
      const a = await db.websiteAudit.findUniqueOrThrow({ where: { id: auditId } });
      if (["COMPLETED", "PARTIAL", "FAILED"].includes(a.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 90_000);
  afterAll(async () => {
    runnerOptions.allowPrivateNetworks = false;
    await site.close();
  });

  it("generates a proposal from audit evidence without inventing numbers", async () => {
    const p = await createProposal(workspaceId, userId, { prospectId, auditId });
    proposalId = p.id;
    const found = (await getProposalWithVersion(workspaceId, proposalId))!;
    const v = found.version;
    expect(v.version).toBe(1);
    expect(v.currency).toBe("GBP");
    const keys = v.sections.map((s) => s.key);
    expect(keys.slice(0, 4)).toEqual(["executive_summary", "opportunity", "business_context", "key_findings"]);
    // The proposal sells the work, not just lists problems.
    expect(keys).toEqual(expect.arrayContaining(["what_you_get", "why_us", "next_steps"]));

    const kf = (v.sections.find((s) => s.key === "key_findings")!.data as { findings: ProposalFinding[] }).findings;
    expect(kf.length).toBeGreaterThan(2);
    const auditFindingIds = new Set((await db.auditFinding.findMany({ where: { auditId } })).map((f) => f.id));
    for (const f of kf) {
      expect(auditFindingIds.has(f.sourceFindingId!)).toBe(true);
      expect(f.where.length).toBeGreaterThan(0);
    }
    // Data-access tasks are not presented as findings.
    expect(kf.some((f) => f.severity === "NEEDS_VERIFICATION")).toBe(false);

    const allText = v.sections.map((s) => s.body).join("\n");
    expect(allText).not.toMatch(/\d+\s?%\s*(increase|more|growth)|guarantee(d)? (first|top|#1)|page one guaranteed/i);
    expect(allText).toMatch(/No guarantee of specific rankings, traffic or revenue/);
    expect(v.sections.find((s) => s.key === "local")!.included).toBe(true);

    const prospect = await db.prospect.findUniqueOrThrow({ where: { id: prospectId } });
    expect(prospect.status).toBe("PROPOSAL_DRAFT");
  });

  it("refuses audits from another prospect or workspace", async () => {
    const other = await createProspect(workspaceId, userId, { businessName: "Other", websiteUrl: "other.example", currency: "USD" });
    await expect(createProposal(workspaceId, userId, { prospectId: other.id, auditId })).rejects.toThrow(ProposalError);
    const ws2 = await createWorkspace("WS2", userId);
    await expect(createProposal(ws2.id, userId, { prospectId, auditId })).rejects.toThrow("Prospect not found");
  });

  function payloadFrom(found: NonNullable<Awaited<ReturnType<typeof getProposalWithVersion>>>, patch: Partial<VersionPayload> = {}): VersionPayload {
    const rv = toRenderVersion(found.version, found.proposal.title);
    return versionPayloadSchema.parse({
      title: rv.title,
      proposalDate: rv.proposalDate,
      validUntil: rv.validUntil,
      currency: rv.currency,
      monthlyPrice: rv.monthlyPrice,
      setupFee: rv.setupFee,
      durationMonths: rv.durationMonths,
      paymentTerms: rv.paymentTerms,
      roadmap: found.version.roadmap,
      theme: rv.theme,
      services: rv.services,
      deliverables: rv.deliverables,
      clientNotes: rv.clientNotes,
      includeAppendix: rv.includeAppendix,
      sections: rv.sections.map((s) => ({ ...s, data: (s.data as VersionPayload["sections"][number]["data"]) ?? null })),
      ...patch,
    });
  }

  it("saves an unsent draft in place, and a sent version only as a new version", async () => {
    let found = (await getProposalWithVersion(workspaceId, proposalId))!;
    const edited = payloadFrom(found, { monthlyPrice: 450, setupFee: 250, paymentTerms: "Monthly in advance." });
    edited.sections[0].body = "Edited summary.";
    const r1 = await saveProposalVersion(workspaceId, userId, proposalId, 1, edited, false);
    expect(r1).toEqual({ version: 1, createdNew: false, lockedBase: false });
    found = (await getProposalWithVersion(workspaceId, proposalId))!;
    expect(found.version.sections[0].body).toBe("Edited summary.");
    expect(found.version.monthlyPrice).toBe(450);

    // Simulate sending v1 (Phase 5 locks versions on send).
    await db.proposalVersion.update({ where: { id: found.version.id }, data: { locked: true } });
    const again = payloadFrom(found);
    again.sections[0].body = "Changed after sending.";
    const r2 = await saveProposalVersion(workspaceId, userId, proposalId, 1, again, false);
    expect(r2).toEqual({ version: 2, createdNew: true, lockedBase: true });

    const v1 = (await getProposalWithVersion(workspaceId, proposalId, 1))!.version;
    const v2 = (await getProposalWithVersion(workspaceId, proposalId, 2))!.version;
    expect(v1.sections[0].body).toBe("Edited summary.");
    expect(v2.sections[0].body).toBe("Changed after sending.");
    expect((await db.proposal.findUniqueOrThrow({ where: { id: proposalId } })).currentVersion).toBe(2);
  });

  it("renders the complete document with findings and acceptance, but no pricing", async () => {
    const found = (await getProposalWithVersion(workspaceId, proposalId, 1))!;
    const html = renderProposalHtml(toRenderVersion(found.version, found.proposal.title), { businessName: "Bright Smile Dental", websiteUrl: site.base, contactName: null });
    expect(html).toContain("Prepared for <strong>Bright Smile Dental</strong>");
    expect(html).toContain("Issues to fix");
    // Prices are agreed with the client at the deal stage: a stored fee never appears in the proposal.
    expect(html).not.toContain("£450");
    expect(html).not.toContain("Investment");
    expect(html).not.toMatch(/class="pricing"/);
    expect(html).toContain("What we found");
    expect(html).toContain("How we fix it");
    // The designed layout: snapshot page with a health score, section icons and the process steps.
    expect(html).toContain("SEO snapshot");
    expect(html).toMatch(/class="ring"/);
    expect(html).toContain('class="steps"');
    expect(html).toContain("Inside this proposal");
    expect(html).toContain("For the client");
    expect(html).toContain("Nova SEO Studio");
    expect(html).not.toMatch(/<script/i);
  });

  it("generates a real PDF, stores it, and never re-renders a locked version", async () => {
    const first = await ensurePdf(workspaceId, userId, proposalId, 1);
    expect(first.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.buffer.length).toBeGreaterThan(20_000);
    expect(first.attachment.fileName).toBe("SEO-Proposal-Bright-Smile-Dental-v1.pdf");
    const second = await ensurePdf(workspaceId, userId, proposalId, 1);
    expect(second.generated).toBe(false);
    expect(second.attachment.sha256).toBe(first.attachment.sha256);
  }, 120_000);

  it("duplicates into an independent draft", async () => {
    const copy = await duplicateProposal(workspaceId, userId, proposalId);
    const found = (await getProposalWithVersion(workspaceId, copy.id))!;
    expect(found.version.version).toBe(1);
    expect(found.version.locked).toBe(false);
    expect(found.version.sections[0].body).toBe("Changed after sending.");
    expect(found.proposal.title).toMatch(/\(copy\)$/);
  });
});

describe("date-only fields", () => {
  it("stores calendar dates at midday UTC so every time zone shows the same day", () => {
    const base = {
      title: "Proposal",
      currency: "USD",
      monthlyPrice: null,
      setupFee: null,
      durationMonths: 6,
      paymentTerms: null,
      roadmap: "90_DAY",
      theme: "navy",
      services: [],
      deliverables: [],
      clientNotes: null,
      includeAppendix: true,
      sections: [{ key: "x", title: "X", body: "", included: true, data: null }],
    };
    const p = versionPayloadSchema.parse({ ...base, proposalDate: "2026-10-22", validUntil: "2026-11-21" });
    expect(p.proposalDate.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    expect(p.validUntil!.toISOString()).toBe("2026-11-21T12:00:00.000Z");
    expect(versionPayloadSchema.parse({ ...base, proposalDate: "2026-10-22", validUntil: "" }).validUntil).toBeNull();
  });
});
