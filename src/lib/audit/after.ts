import "server-only";
import { db } from "../db";
import { logger } from "../log";
import { notify } from "../notifications";
import { createProposal } from "../proposals/service";
import { getApiKey } from "../integrations";
import { setStage } from "./runner";

const log = logger("audit");

/**
 * Runs after an audit job ends (success or failure): drafts the proposal when the user asked for
 * it on the audit form, and sends the in-app alert. Batch audits alert once, when the whole batch is done.
 * Never throws — the audit itself is already saved.
 */
/** Keyword ideas from the audit (services, pages, optional Gemini), with the top 10 chosen for the proposal. */
async function autoKeywords(audit: { id: string; workspaceId: string; prospectId: string; batchId: string | null }) {
  const { chooseTopKeywords, generateAiKeywordIdeas, generateSeedKeywords } = await import("../research/service");
  const notes: string[] = [];
  try {
    await generateSeedKeywords(audit.workspaceId, audit.prospectId);
  } catch (e) {
    notes.push((e as Error).message);
  }
  // AI ideas take a while and use the Gemini quota, so bulk audits keep to the service-based ideas.
  if (!audit.batchId && (await getApiKey(audit.workspaceId, "GEMINI"))) {
    try {
      const r = await generateAiKeywordIdeas(audit.workspaceId, audit.prospectId);
      notes.push(`${r.created} AI ideas`);
    } catch (e) {
      notes.push(`AI ideas skipped: ${(e as Error).message}`);
    }
  }
  if (!(await db.keyword.count({ where: { prospectId: audit.prospectId, inProposal: true } }))) await chooseTopKeywords(audit.workspaceId, audit.prospectId, 10);
  const total = await db.keyword.count({ where: { prospectId: audit.prospectId } });
  await setStage(
    audit.id,
    "KEYWORDS",
    total ? "COMPLETED" : "SKIPPED",
    total
      ? `${total} keyword ideas, top ${Math.min(total, 10)} chosen for the proposal${notes.length ? ` (${notes.join("; ")})` : ""}. Search volumes need data: import a Keyword Planner or Search Console file on Research → Imports.`
      : notes.join("; ") || "No services found to build keyword ideas from — add the prospect's services and audit again.",
  );
}

/** Observes the competitors already added for this prospect (up to three). */
async function autoCompetitors(audit: { id: string; workspaceId: string; prospectId: string }) {
  const competitors = await db.competitor.findMany({ where: { prospectId: audit.prospectId, workspaceId: audit.workspaceId }, orderBy: { createdAt: "asc" }, take: 3 });
  if (!competitors.length) {
    await setStage(audit.id, "COMPETITORS", "SKIPPED", "No competitors added yet. Add 1–3 competitor websites on Research → Competitors; they are checked automatically on every audit after that.");
    return;
  }
  const { observeCompetitor } = await import("../research/service");
  const done: string[] = [];
  const failed: string[] = [];
  for (const c of competitors) {
    try {
      const r = await observeCompetitor(audit.workspaceId, c.id);
      done.push(`${c.domain} (${r.pagesAnalysed} pages)`);
    } catch {
      failed.push(c.domain);
    }
  }
  await setStage(audit.id, "COMPETITORS", failed.length ? "PARTIAL" : "COMPLETED", [done.length ? `Observed ${done.join(", ")}` : "", failed.length ? `Could not reach ${failed.join(", ")}` : ""].filter(Boolean).join(". "));
}

export async function afterAudit(auditId: string) {
  try {
    const audit = await db.websiteAudit.findUnique({ where: { id: auditId }, include: { prospect: { select: { businessName: true } } } });
    if (!audit || audit.status === "QUEUED" || audit.status === "RUNNING") return;
    const ok = audit.status === "COMPLETED" || audit.status === "PARTIAL";

    if (ok) {
      await autoKeywords(audit).catch((e) => log.info("keyword research failed", { auditId, reason: (e as Error).message }));
      // Website technology and email health, for the pitch notes on the prospect page.
      await import("../site-profile").then((m) => m.checkProspectProfile(audit.workspaceId, audit.prospectId)).catch((e) => log.info("technology check failed", { auditId, reason: (e as Error).message }));
    }

    // With a working Places key, the business profile is refreshed so the proposal can include it.
    if (ok && !audit.batchId && audit.requestedById && (await getApiKey(audit.workspaceId, "PLACES"))) {
      const recent = await db.gbpProfile.findFirst({ where: { prospectId: audit.prospectId, fetchedAt: { gt: new Date(Date.now() - 14 * 86_400_000) } } });
      if (!recent) {
        const { fetchGbpProfile } = await import("../research/service");
        await fetchGbpProfile(audit.workspaceId, audit.requestedById, audit.prospectId).catch((e) => log.info("business profile not fetched", { auditId, reason: (e as Error).message }));
      }
    }

    let proposalId: string | null = null;
    if (ok && audit.autoProposal && audit.requestedById) {
      const existing = await db.proposal.findFirst({ where: { auditId }, select: { id: true } });
      proposalId = existing?.id ?? (await createProposal(audit.workspaceId, audit.requestedById, { prospectId: audit.prospectId, auditId })).id;
    }

    if (audit.batchId) {
      if (ok) await setStage(auditId, "COMPETITORS", "SKIPPED", "Not part of bulk audits — open the prospect's Research page to compare competitors.");
      const open = await db.websiteAudit.count({ where: { batchId: audit.batchId, status: { in: ["QUEUED", "RUNNING"] } } });
      if (open === 0) {
        const batch = await db.auditBatch.findUnique({ where: { id: audit.batchId }, include: { _count: { select: { audits: true } } } });
        if (batch) await notify({ workspaceId: audit.workspaceId, title: `Bulk audit finished: ${batch.name}`, body: `${batch._count.audits} websites checked${audit.autoProposal ? ", proposals ready to send" : ""}.`, link: `/audits/bulk/${batch.id}` });
      }
      return;
    }

    await notify({
      workspaceId: audit.workspaceId,
      userId: audit.requestedById,
      title: !ok ? `Audit failed for ${audit.prospect.businessName}` : proposalId ? `Proposal ready for ${audit.prospect.businessName}` : `Audit finished for ${audit.prospect.businessName}`,
      body: !ok ? "Open the audit to see why and retry." : proposalId ? "Review it, then send it by email." : "Review the findings and create a proposal.",
      link: proposalId ? `/proposals/${proposalId}` : `/audits/${auditId}`,
    });

    // Competitor sites take a minute each, so they are checked after the alert.
    if (ok) await autoCompetitors(audit).catch((e) => log.info("competitor research failed", { auditId, reason: (e as Error).message }));
  } catch (e) {
    log.error("after-audit step failed", { auditId, err: e });
  }
}
