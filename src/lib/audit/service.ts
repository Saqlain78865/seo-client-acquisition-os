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

/**
 * A Google Business Profile / Maps link instead of a website: the profile is read with the Places API
 * (saved first, as the main subject), then the website on the profile is audited as the second part.
 * Without a Places key there is no allowed way to read the profile, so the user is told what to do.
 */
export async function startAuditFromGbpLink(workspaceId: string, userId: string, req: AuditRequest) {
  const { getApiKey } = await import("../integrations");
  const { resolveGbpLink } = await import("../research/gbp-link");
  const { GbpError, fetchGbpByPlaceId, findPlaceFromLink } = await import("../research/gbp");
  const key = await getApiKey(workspaceId, "PLACES");
  if (!key) {
    throw new AuditRequestError(
      "This is a Google Business Profile link. Reading a profile needs a Google key with the Places API (free monthly quota) on the Integrations page. Until then, paste the business's website address instead — you can add the profile details by hand on its Research page.",
    );
  }
  let link;
  try {
    link = await resolveGbpLink(req.websiteUrl);
  } catch {
    throw new AuditRequestError("This Google Maps link could not be opened. Copy it again from the profile's Share button.");
  }
  if (!link.name) throw new AuditRequestError("The link does not name a business. Copy it from the profile's Share button and try again.");
  let profile;
  try {
    const placeId = await findPlaceFromLink(key, { name: link.name, lat: link.lat, lng: link.lng });
    if (!placeId) throw new GbpError(`No Google Business Profile found for “${link.name}”.`, "NOT_FOUND");
    profile = await fetchGbpByPlaceId(key, placeId, link.name, []);
  } catch (e) {
    throw new AuditRequestError(e instanceof GbpError ? e.message : "Google Places could not be reached. Try again in a moment.");
  }
  if (!profile.website) {
    throw new AuditRequestError(`${profile.name} has no website on its Google profile, so there is no website to audit. Add their website address if they have one.`);
  }
  const started = await startAudit(workspaceId, userId, { ...req, websiteUrl: profile.website, clientName: req.clientName || profile.name }, { primary: "GBP" });
  const { saveGbp } = await import("../research/service");
  await saveGbp(workspaceId, userId, started.prospect.id, { ...profile, mapsUrl: profile.mapsUrl ?? link.url });
  return started;
}

/** Validates the URL, links or creates the prospect, records the audit and queues it. */
export async function startAudit(workspaceId: string, userId: string, req: AuditRequest, opts: { batchId?: string; quick?: boolean; primary?: "GBP" } = {}) {
  // Any page link (a product page, a blog post…) audits the whole website: the audit and the
  // prospect use the site's home address; the pasted link is kept as the audit's input.
  const normalizedUrl = `${new URL(normalizeWebsiteUrl(req.websiteUrl)).origin}/`;
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
        // "GBP" when the audit was started from a Google Business Profile link: the proposal leads with the profile.
        primary: opts.primary,
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
