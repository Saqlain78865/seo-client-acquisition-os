import "server-only";
import { db } from "../db";
import { ACTIVITY_TYPES, logActivity } from "../activity";
import { assertPublicHost, assertUrlShape, BlockedUrlError } from "../crawler/network-guard";
import { normalizeDomain, normalizeWebsiteUrl } from "../url";
import { addContact, createProspect } from "../prospects";
import { enqueueJob, JOB_TYPES } from "../jobs";
import { AUDIT_STAGES } from "./stages";
import { runnerOptions } from "./runner";
import type { AuditRequest } from "../validation";

export class AuditRequestError extends Error {}

/** Validates the URL, links or creates the prospect, records the audit and queues it. */
export async function startAudit(workspaceId: string, userId: string, req: AuditRequest, opts: { batchId?: string; quick?: boolean } = {}) {
  const normalizedUrl = normalizeWebsiteUrl(req.websiteUrl);
  let host: string;
  try {
    host = assertUrlShape(normalizedUrl, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks }).hostname;
    await assertPublicHost(host, { allowPrivateNetworks: runnerOptions.allowPrivateNetworks });
  } catch (e) {
    if (e instanceof BlockedUrlError) throw new AuditRequestError(`This URL cannot be audited: ${e.message}.`);
    throw new AuditRequestError(`The domain ${new URL(normalizedUrl).hostname} could not be found. Check the spelling.`);
  }
  const domain = normalizeDomain(normalizedUrl);

  let prospect = req.prospectId ? await db.prospect.findFirst({ where: { id: req.prospectId, workspaceId } }) : null;
  if (req.prospectId && !prospect) throw new AuditRequestError("Prospect not found.");
  prospect ??= await db.prospect.findFirst({ where: { workspaceId, domain }, orderBy: { createdAt: "asc" } });
  const createdProspect = !prospect;
  if (!prospect) {
    prospect = await createProspect(workspaceId, userId, {
      // Placeholder until the audit infers (unverified) or the user enters the real name.
      businessName: req.clientName || domain,
      websiteUrl: normalizedUrl,
      country: req.targetCountry,
      city: req.targetCity,
      primaryServices: [req.primaryService, req.secondaryServices].filter(Boolean).join(", ") || undefined,
      industry: req.businessType,
      leadSource: "Website audit outreach",
      notes: req.discoveryNotes,
      currency: req.currency,
      contactName: req.contactName,
      email: req.email,
      whatsapp: req.whatsapp,
    });
    await logActivity({ workspaceId, prospectId: prospect.id, userId, type: ACTIVITY_TYPES.PROSPECT_CREATED, message: `Prospect ${prospect.businessName} created from website audit` });
  } else {
    for (const [type, value] of [
      ["PERSON_NAME", req.contactName],
      ["EMAIL", req.email],
      ["WHATSAPP", req.whatsapp],
    ] as const) {
      if (value) await addContact(prospect.id, { type, value });
    }
  }

  const audit = await db.websiteAudit.create({
    data: {
      workspaceId,
      prospectId: prospect.id,
      inputUrl: req.websiteUrl,
      normalizedUrl,
      requestedById: userId,
      autoProposal: req.autoProposal ?? false,
      batchId: opts.batchId,
      context: {
        quick: opts.quick || undefined,
        targetCountry: req.targetCountry,
        targetCity: req.targetCity,
        primaryService: req.primaryService,
        secondaryServices: req.secondaryServices,
        preferredLanguage: req.preferredLanguage,
        businessType: req.businessType,
        servicePackage: req.servicePackage,
        currency: req.currency,
        discoveryNotes: req.discoveryNotes,
      },
      runs: { create: AUDIT_STAGES.map((s) => ({ stage: s.key, status: "PENDING" })) },
    },
  });
  await enqueueJob(workspaceId, JOB_TYPES.AUDIT_RUN, { auditId: audit.id });
  await logActivity({ workspaceId, prospectId: prospect.id, userId, type: ACTIVITY_TYPES.AUDIT_STARTED, message: `Website audit started for ${host}`, metadata: { auditId: audit.id } });
  return { audit, prospect, createdProspect };
}

/** Re-queues a failed or partial audit. Completed stages are kept and not repeated. */
export async function retryAudit(workspaceId: string, auditId: string) {
  const audit = await db.websiteAudit.findFirst({ where: { id: auditId, workspaceId } });
  if (!audit) throw new AuditRequestError("Audit not found.");
  if (audit.status !== "FAILED" && audit.status !== "PARTIAL") throw new AuditRequestError("Only failed or partial audits can be retried.");
  await db.auditRun.updateMany({ where: { auditId, status: { in: ["FAILED", "PARTIAL", "RUNNING"] } }, data: { status: "PENDING", message: null } });
  // Downstream stages depend on the retried ones, so they are recomputed too.
  const order: string[] = AUDIT_STAGES.map((s) => s.key);
  const runs = await db.auditRun.findMany({ where: { auditId } });
  // Keyword and competitor research run after the audit (after.ts) and never invalidate other stages.
  const research = ["KEYWORDS", "COMPETITORS"];
  const firstPending = Math.min(...runs.filter((r) => r.status === "PENDING" && !research.includes(r.stage)).map((r) => order.indexOf(r.stage)), order.length);
  const downstream = order.slice(firstPending).filter((k) => !research.includes(k));
  await db.auditRun.updateMany({ where: { auditId, stage: { in: downstream } }, data: { status: "PENDING", message: null } });
  await db.websiteAudit.update({ where: { id: auditId }, data: { status: "QUEUED", completedAt: null } });
  await enqueueJob(workspaceId, JOB_TYPES.AUDIT_RUN, { auditId });
}
