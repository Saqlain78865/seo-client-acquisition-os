import "server-only";
import { db } from "../db";
import { logger } from "../log";
import { notify } from "../notifications";
import { createProposal } from "../proposals/service";
import { getApiKey } from "../integrations";

const log = logger("audit");

/**
 * Runs after an audit job ends (success or failure): drafts the proposal when the user asked for
 * it on the audit form, and sends the in-app alert. Batch audits alert once, when the whole batch is done.
 * Never throws — the audit itself is already saved.
 */
export async function afterAudit(auditId: string) {
  try {
    const audit = await db.websiteAudit.findUnique({ where: { id: auditId }, include: { prospect: { select: { businessName: true } } } });
    if (!audit || audit.status === "QUEUED" || audit.status === "RUNNING") return;
    const ok = audit.status === "COMPLETED" || audit.status === "PARTIAL";

    if (audit.batchId) {
      const open = await db.websiteAudit.count({ where: { batchId: audit.batchId, status: { in: ["QUEUED", "RUNNING"] } } });
      if (open === 0) {
        const batch = await db.auditBatch.findUnique({ where: { id: audit.batchId }, include: { _count: { select: { audits: true } } } });
        if (batch) await notify({ workspaceId: audit.workspaceId, title: `Bulk audit finished: ${batch.name}`, body: `${batch._count.audits} websites checked and ranked by opportunity.`, link: `/audits/bulk/${batch.id}` });
      }
      return;
    }

    // With a working Places key, the business profile is refreshed so the proposal can include it.
    if (ok && audit.requestedById && (await getApiKey(audit.workspaceId, "PLACES"))) {
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
    await notify({
      workspaceId: audit.workspaceId,
      userId: audit.requestedById,
      title: !ok ? `Audit failed for ${audit.prospect.businessName}` : proposalId ? `Proposal ready for ${audit.prospect.businessName}` : `Audit finished for ${audit.prospect.businessName}`,
      body: !ok ? "Open the audit to see why and retry." : proposalId ? "Review it, then send it by email or WhatsApp." : "Review the findings and create a proposal.",
      link: proposalId ? `/proposals/${proposalId}` : `/audits/${auditId}`,
    });
  } catch (e) {
    log.error("after-audit step failed", { auditId, err: e });
  }
}
