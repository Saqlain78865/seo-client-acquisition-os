import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { runnerOptions } from "@/lib/audit/runner";
import { retryAudit, startAudit, AuditRequestError } from "@/lib/audit/service";
import { getBatchResults, startBulkAudit } from "@/lib/audit/bulk";
import { startFixtureSite } from "./fixtures/site";

let site: Awaited<ReturnType<typeof startFixtureSite>>;
let workspaceId: string;
let userId: string;

async function waitForAudit(auditId: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const a = await db.websiteAudit.findUniqueOrThrow({ where: { id: auditId } });
    if (["COMPLETED", "PARTIAL", "FAILED"].includes(a.status)) return a;
    if (Date.now() > until) throw new Error(`Audit still ${a.status}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Keyword and competitor research run right after the audit, inside the same job. */
async function waitForStage(auditId: string, stage: "KEYWORDS" | "COMPETITORS", timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await db.auditRun.findUnique({ where: { auditId_stage: { auditId, stage } } });
    if (r && r.status !== "PENDING" && r.status !== "RUNNING") return r;
    if (Date.now() > until) throw new Error(`${stage} still ${r?.status}`);
    await new Promise((res) => setTimeout(res, 200));
  }
}

beforeAll(async () => {
  runnerOptions.allowPrivateNetworks = true;
  site = await startFixtureSite();
  const user = await db.user.create({ data: { email: `runner${Date.now()}@test.example`, name: "Runner", passwordHash: "x" } });
  userId = user.id;
  workspaceId = (await createWorkspace("Runner WS", user.id)).id;
  await db.workspaceSettings.update({ where: { workspaceId }, data: { crawlDelayMs: 250, crawlPageLimit: 20 } });
});
afterAll(async () => {
  runnerOptions.allowPrivateNetworks = false;
  await site.close();
});

describe("full audit through the job queue", () => {
  let auditId: string;
  let prospectId: string;

  it("creates a prospect from the URL and completes every stage", async () => {
    const { audit, prospect, createdProspect } = await startAudit(workspaceId, userId, { websiteUrl: site.base, currency: "USD", targetCity: "Leeds" });
    auditId = audit.id;
    prospectId = prospect.id;
    expect(createdProspect).toBe(true);
    const done = await waitForAudit(auditId);
    expect(["COMPLETED", "PARTIAL"]).toContain(done.status);

    const runs = await db.auditRun.findMany({ where: { auditId } });
    const status = Object.fromEntries(runs.map((r) => [r.stage, r.status]));
    expect(status.CRAWL).toBe("COMPLETED");
    expect(status.EVIDENCE_VALIDATION).toBe("COMPLETED");
    // Keyword ideas come from the services found on the site; with no competitors added, that stage says so.
    const keywords = await waitForStage(auditId, "KEYWORDS");
    expect(keywords.status).toBe("COMPLETED");
    expect(keywords.message).toMatch(/keyword ideas, top \d+ chosen for the proposal/);
    expect(await db.keyword.count({ where: { prospectId, inProposal: true } })).toBeGreaterThan(0);
    const competitors = await waitForStage(auditId, "COMPETITORS");
    expect(competitors.status).toBe("SKIPPED");
    expect(competitors.message).toMatch(/No competitors added yet/);
    // No GEMINI_API_KEY in tests: AI is skipped, never faked.
    expect(status.AI_ANALYSIS).toBe("SKIPPED");
    expect(status.REPORT).toBe("COMPLETED");
  }, 90_000);

  it("stores findings with evidence and a rule-based summary", async () => {
    const audit = await db.websiteAudit.findUniqueOrThrow({ where: { id: auditId }, include: { findings: { include: { evidence: true } }, pages: true } });
    expect(audit.pages.length).toBeGreaterThan(5);
    expect(audit.findings.length).toBeGreaterThan(5);
    for (const f of audit.findings) expect(f.evidence.length).toBeGreaterThan(0);
    expect(audit.summary).toMatch(/Rankings, organic traffic, index coverage and backlinks were not measured/);
    expect((audit.analysis as { summarySource: string }).summarySource).toBe("Rule-based");
  });

  it("names the prospect from the site (unverified) and saves contacts as unverified with sources", async () => {
    const p = await db.prospect.findUniqueOrThrow({ where: { id: prospectId }, include: { contacts: true, activities: true } });
    expect(p.businessName).toBe("Bright Smile Dental");
    expect(p.status).toBe("AUDIT_COMPLETED");
    const email = p.contacts.find((c) => c.type === "EMAIL")!;
    expect(email.value).toBe("hello@brightsmile.example");
    expect(email.verified).toBe(false);
    expect(email.sourceMethod).toBe("CRAWL");
    expect(email.sourceUrl).toBe(`${site.base}/contact`);
    expect(p.activities.some((a) => a.type === "audit.completed")).toBe(true);
  });

  it("retries without re-crawling when the crawl already succeeded", async () => {
    await db.auditRun.update({ where: { auditId_stage: { auditId, stage: "REPORT" } }, data: { status: "FAILED" } });
    await db.websiteAudit.update({ where: { id: auditId }, data: { status: "FAILED" } });
    const requestsBefore = site.requested.length;
    await retryAudit(workspaceId, auditId);
    const done = await waitForAudit(auditId);
    expect(["COMPLETED", "PARTIAL"]).toContain(done.status);
    expect(site.requested.length).toBe(requestsBefore);
    expect((await db.auditRun.findUniqueOrThrow({ where: { auditId_stage: { auditId, stage: "REPORT" } } })).status).toBe("COMPLETED");
  }, 90_000);

  it("re-auditing an existing domain reuses the prospect and keeps history", async () => {
    const { audit, createdProspect, prospect } = await startAudit(workspaceId, userId, { websiteUrl: `${site.base}/about`, currency: "USD" });
    expect(createdProspect).toBe(false);
    expect(prospect.id).toBe(prospectId);
    await waitForAudit(audit.id);
    expect(await db.websiteAudit.count({ where: { prospectId } })).toBe(2);
  }, 90_000);

  it("drafts the proposal automatically and alerts the user when asked to", async () => {
    const { audit } = await startAudit(workspaceId, userId, { websiteUrl: `${site.base}/services`, currency: "USD", autoProposal: true });
    await waitForAudit(audit.id);
    let proposal = null;
    for (let i = 0; i < 50 && !proposal; i++) {
      proposal = await db.proposal.findFirst({ where: { auditId: audit.id } });
      if (!proposal) await new Promise((r) => setTimeout(r, 200));
    }
    expect(proposal).not.toBeNull();
    // A local test site has no public domain, so the domain stage is skipped rather than guessed.
    expect((await db.auditRun.findUniqueOrThrow({ where: { auditId_stage: { auditId: audit.id, stage: "DOMAIN" } } })).status).toBe("SKIPPED");
    const alert = await db.notification.findFirst({ where: { workspaceId, link: `/proposals/${proposal!.id}` } });
    expect(alert?.title).toMatch(/^Proposal ready for /);
  }, 90_000);

  it("bulk audit queues quick audits and ranks them by opportunity", async () => {
    await expect(startBulkAudit(workspaceId, userId, { sites: "  \n " })).rejects.toThrow(AuditRequestError);
    const { batch, queued, skipped } = await startBulkAudit(workspaceId, userId, { name: "Leeds dentists", sites: `${site.base}\nnot-a-site` });
    expect(queued).toBe(1);
    expect(skipped).toEqual([{ site: "not-a-site", reason: "Not a valid website address" }]);
    const audit = await db.websiteAudit.findFirstOrThrow({ where: { batchId: batch.id } });
    expect((audit.context as { quick?: boolean }).quick).toBe(true);
    await waitForAudit(audit.id);
    let results = await getBatchResults(workspaceId, batch.id);
    for (let i = 0; i < 50 && results!.active > 0; i++) {
      await new Promise((r) => setTimeout(r, 200));
      results = await getBatchResults(workspaceId, batch.id);
    }
    expect(results!.rows[0].opportunity!.score).toBeGreaterThan(0);
    expect(results!.rows[0].contact).toBe("hello@brightsmile.example");
    expect(await getBatchResults("someone-else", batch.id)).toBeNull();
    let done = null;
    for (let i = 0; i < 50 && !done; i++) {
      done = await db.notification.findFirst({ where: { workspaceId, link: `/audits/bulk/${batch.id}` } });
      if (!done) await new Promise((r) => setTimeout(r, 200));
    }
    expect(done?.title).toBe("Bulk audit finished: Leeds dentists");
  }, 90_000);

  it("never lets one workspace audit or retry another's records", async () => {
    const other = await createWorkspace("Other", userId);
    await expect(retryAudit(other.id, auditId)).rejects.toThrow(AuditRequestError);
    const p = await createProspect(workspaceId, userId, { businessName: "X", websiteUrl: "x.example", currency: "USD" });
    await expect(startAudit(other.id, userId, { websiteUrl: site.base, prospectId: p.id, currency: "USD" })).rejects.toThrow("Prospect not found");
  });
});

describe("URL validation before an audit starts", () => {
  it("rejects private addresses in normal mode", async () => {
    runnerOptions.allowPrivateNetworks = false;
    await expect(startAudit(workspaceId, userId, { websiteUrl: "http://127.0.0.1/", currency: "USD" })).rejects.toThrow(/cannot be audited/);
    await expect(startAudit(workspaceId, userId, { websiteUrl: "https://definitely-not-a-real-domain-xyz123.invalid", currency: "USD" })).rejects.toThrow(/could not be found/);
    runnerOptions.allowPrivateNetworks = true;
  });
});
