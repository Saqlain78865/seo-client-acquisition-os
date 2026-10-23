import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { getReports } from "@/lib/reports";

describe("reports", () => {
  it("are computed only from saved records", async () => {
    const user = await db.user.create({ data: { email: `rep${Date.now()}@test.example`, name: "R", passwordHash: "x" } });
    const ws = (await createWorkspace("Reports WS", user.id)).id;
    const empty = await getReports(ws);
    expect(empty.totals).toEqual({ prospects: 0, audits: 0, proposals: 0, won: 0, lost: 0 });
    expect(empty.medianAuditToProposalDays).toBeNull();

    const a = await createProspect(ws, user.id, { businessName: "A", websiteUrl: "a.example", currency: "USD", leadSource: "Referral" });
    const b = await createProspect(ws, user.id, { businessName: "B", websiteUrl: "b.example", currency: "USD", leadSource: "Referral" });
    await createProspect(ws, user.id, { businessName: "C", websiteUrl: "c.example", currency: "USD" });

    const day = 86400_000;
    const auditDone = new Date(Date.now() - 10 * day);
    const audit = await db.websiteAudit.create({ data: { workspaceId: ws, prospectId: a.id, inputUrl: "a.example", normalizedUrl: "https://a.example", status: "COMPLETED", completedAt: auditDone } });
    await db.auditFinding.create({ data: { auditId: audit.id, ruleId: "onpage.title-missing", category: "On-Page SEO", title: "Pages without a title tag", severity: "HIGH", evidenceStatus: "CONFIRMED", affectedUrls: [], observedFacts: "x", recommendation: "y" } });
    const proposal = await db.proposal.create({ data: { workspaceId: ws, prospectId: a.id, title: "P", status: "SENT", createdAt: new Date(auditDone.getTime() + 2 * day) } });
    await db.deal.create({ data: { workspaceId: ws, prospectId: a.id, proposalId: proposal.id, title: "A", stage: "WON", value: 900, currency: "USD", closedAt: new Date(auditDone.getTime() + 7 * day) } });
    await db.deal.create({ data: { workspaceId: ws, prospectId: b.id, title: "B", stage: "LOST", lostReason: "Budget", closedAt: new Date() } });

    const r = await getReports(ws);
    expect(r.totals).toMatchObject({ prospects: 3, audits: 1, proposals: 1, won: 1, lost: 1 });
    expect(r.medianAuditToProposalDays).toBeCloseTo(2, 5);
    expect(r.medianProposalToWonDays).toBeCloseTo(5, 5);
    expect(r.wonValue).toEqual({ USD: 900 });
    expect(r.sources.find((s) => s.source === "Referral")).toEqual({ source: "Referral", prospects: 2, sent: 1, won: 1 });
    expect(r.commonIssues[0]).toMatchObject({ ruleId: "onpage.title-missing", audits: 1, share: 100 });
    expect(r.lostReasons).toEqual([{ reason: "Budget", count: 1 }]);
    expect(r.monthly.reduce((s, m) => s + m.prospects, 0)).toBe(3);
  });
});
