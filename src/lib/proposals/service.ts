import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { ACTIVITY_TYPES, logActivity } from "../activity";
import { CURRENCIES } from "../constants";
import { getFile, putFile } from "../storage";
import { defaultDeliverables, defaultServices, generateSections, type SourceFinding } from "./generate";
import { htmlToPdf } from "./pdf";
import { qrDataUri } from "../messaging/share";
import { toWaNumber } from "../messaging/whatsapp";
import { pdfFooterTemplate, renderProposalHtml, type RenderVersion } from "./render";
import { THEME_KEYS } from "./theme";
import { PAGE_TYPE_LABELS, type PageType } from "../crawler/classify";
import { badReviews, gbpIssues, type GbpData } from "../research/gbp";
import {
  ROADMAPS,
  SERVICE_KEYS,
  deliverableSchema,
  proposalFindingSchema,
  proposalKeywordSchema,
  proposalGbpSchema,
  proposalReviewSchema,
  proposalScreensSchema,
  roadmapPhaseSchema,
  type Branding,
  type Deliverable,
  type ProposalGbp,
  type ProposalKeyword,
  type ProposalReview,
  type RoadmapKey,
  type ServiceKey,
} from "./types";

export class ProposalError extends Error {}

const EARLY_STATUSES = ["NEW_PROSPECT", "AUDIT_IN_PROGRESS", "AUDIT_COMPLETED"];
const ROADMAP_MONTHS: Record<RoadmapKey, number> = { "90_DAY": 3, "6_MONTH": 6, "12_MONTH": 12 };

export async function currentBranding(workspaceId: string): Promise<Branding> {
  const s = await db.workspaceSettings.findUnique({ where: { workspaceId } });
  let logoDataUri: string | null = null;
  if (s?.logoPath) {
    try {
      const buf = await getFile(s.logoPath);
      const mime = s.logoPath.endsWith(".png") ? "image/png" : s.logoPath.endsWith(".webp") ? "image/webp" : "image/jpeg";
      logoDataUri = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      logoDataUri = null;
    }
  }
  return {
    companyName: s?.companyName ?? null,
    consultantName: s?.consultantName ?? null,
    email: s?.companyEmail ?? null,
    phone: s?.companyPhone ?? null,
    website: s?.companyWebsite ?? null,
    whatsapp: s?.consultantWhatsApp ?? null,
    logoDataUri,
    brandColor: s?.brandColor ?? null,
    whatsappQr: s?.consultantWhatsApp && toWaNumber(s.consultantWhatsApp) ? await qrDataUri(`https://wa.me/${toWaNumber(s.consultantWhatsApp)}`) : null,
  };
}

export const MAX_PROPOSAL_KEYWORDS = 20;

/**
 * Keywords for the proposal: the ones chosen on the Research tab, or — when none are chosen — the
 * highest-priority non-brand keywords, so a proposal made straight from an audit still shows targets.
 */
export async function proposalKeywords(workspaceId: string, prospectId: string): Promise<{ keywords: ProposalKeyword[]; chosen: boolean }> {
  const base = { workspaceId, prospectId };
  const chosen = await db.keyword.findMany({ where: { ...base, inProposal: true }, orderBy: [{ priority: "desc" }, { keyword: "asc" }], take: MAX_PROPOSAL_KEYWORDS });
  const rows = chosen.length
    ? chosen
    : await db.keyword.findMany({ where: { ...base, NOT: { intent: "NAVIGATIONAL" } }, orderBy: [{ priority: "desc" }, { keyword: "asc" }], take: 8 });
  return {
    chosen: chosen.length > 0,
    keywords: rows.map((k) => ({
      keyword: k.keyword.slice(0, 120),
      intent: k.intent,
      volume: k.searchVolume,
      volumeIsEstimate: k.volumeIsEstimate,
      source: k.dataSource.slice(0, 200),
      targetUrl: k.targetUrl,
      suggestedPage: k.recommendedPageType ? (PAGE_TYPE_LABELS[k.recommendedPageType as PageType] ?? null) : null,
    })),
  };
}

/** The latest Google Business Profile of the prospect, shaped for the proposal (reviewer names left out). */
export async function proposalGbp(prospectId: string, domain: string): Promise<{ gbp: ProposalGbp | null; badReviews: ProposalReview[] }> {
  const row = await db.gbpProfile.findFirst({ where: { prospectId }, orderBy: { fetchedAt: "desc" } });
  if (!row) return { gbp: null, badReviews: [] };
  const data = { reviews: (row.reviews as GbpData["reviews"]) ?? [], rankings: (row.rankings as GbpData["rankings"]) ?? [] };
  const g = { ...row, ...data, source: row.source as GbpData["source"] } as GbpData;
  return {
    gbp: {
      name: row.name.slice(0, 200),
      category: row.category,
      rating: row.rating,
      reviewCount: row.reviewCount,
      photoCount: row.photoCount,
      hasHours: row.hasHours,
      source: row.source,
      rankings: data.rankings.slice(0, 5).map((r) => ({ query: r.query.slice(0, 120), position: r.position, total: r.total })),
      issues: gbpIssues(g, domain).slice(0, 15).map((i) => ({ severity: i.severity, title: i.title.slice(0, 200), fix: i.fix.slice(0, 400) })),
    },
    badReviews: badReviews(g)
      .slice(0, 5)
      .map((r) => ({ rating: Math.min(5, Math.max(1, Math.round(r.rating))), text: r.text.length > 600 ? `${r.text.slice(0, 597)}…` : r.text, when: r.when })),
  };
}

/** Creates a proposal (version 1) from an audit, or a blank one for a prospect when no audit is given. */
export async function createProposal(workspaceId: string, userId: string, input: { prospectId: string; auditId?: string | null }) {
  const prospect = await db.prospect.findFirst({ where: { id: input.prospectId, workspaceId } });
  if (!prospect) throw new ProposalError("Prospect not found.");
  const audit = input.auditId
    ? await db.websiteAudit.findFirst({
        where: { id: input.auditId, workspaceId, prospectId: prospect.id },
        include: { findings: { include: { evidence: { take: 1, orderBy: { collectedAt: "asc" } } } } },
      })
    : null;
  if (input.auditId && !audit) throw new ProposalError("Audit not found for this prospect.");
  if (audit && audit.status !== "COMPLETED" && audit.status !== "PARTIAL") throw new ProposalError("Wait for the audit to finish before creating a proposal.");

  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId } });
  const analysis = (audit?.analysis ?? {}) as {
    business?: { name: { value: string } | null; services: { value: string }[]; locations: { value: string }[] };
    scope?: { pagesAnalysed: number; pageLimit: number; limitReached: boolean; collectedAt: string };
    ai?: { findingExplanations?: { ruleId: string; clientExplanation: string }[] } | null;
  };
  const context = (audit?.context ?? {}) as Record<string, string | undefined>;
  const findings: SourceFinding[] = (audit?.findings ?? []).map((f) => ({ ...f, affectedUrls: f.affectedUrls as string[] }));

  const genAudit = audit
    ? {
        createdAt: audit.createdAt,
        summary: audit.summary,
        context,
        scope: analysis.scope ?? null,
        business: analysis.business
          ? { name: analysis.business.name?.value ?? null, services: analysis.business.services.map((s) => s.value), locations: analysis.business.locations.map((l) => l.value) }
          : null,
        aiExplanations: Object.fromEntries((analysis.ai?.findingExplanations ?? []).map((e) => [e.ruleId, e.clientExplanation])),
      }
    : null;
  const [{ keywords }, { gbp, badReviews: negative }, shots] = await Promise.all([
    proposalKeywords(workspaceId, prospect.id),
    proposalGbp(prospect.id, prospect.domain),
    audit ? db.auditScreenshot.findMany({ where: { auditId: audit.id } }) : [],
  ]);
  const services = defaultServices(findings, { audit: genAudit, prospect, gbp, badReviews: negative });
  const screens = { desktop: shots.find((x) => x.kind === "HOMEPAGE_DESKTOP")?.storageKey ?? null, mobile: shots.find((x) => x.kind === "HOMEPAGE_MOBILE")?.storageKey ?? null };
  const screenshots = Object.fromEntries(shots.filter((x) => x.kind === "FINDING" && x.ruleId).map((x) => [x.ruleId!, x.storageKey]));
  const roadmap: RoadmapKey = "90_DAY";
  const sections = generateSections({
    prospect,
    audit: genAudit,
    findings,
    services,
    roadmap,
    keywords,
    gbp,
    badReviews: negative,
    screens,
    screenshots,
    consultantName: settings?.consultantName ?? null,
    companyName: settings?.companyName ?? null,
  });
  const currency = context.currency ?? prospect.currency ?? settings?.defaultCurrency ?? "USD";
  const title = `SEO proposal for ${prospect.businessName}`;

  const proposal = await db.proposal.create({
    data: {
      workspaceId,
      prospectId: prospect.id,
      auditId: audit?.id,
      title,
      versions: {
        create: {
          version: 1,
          title,
          currency,
          roadmap,
          durationMonths: Math.max(ROADMAP_MONTHS[roadmap], 6),
          services,
          deliverables: defaultDeliverables(services),
          theme: settings?.proposalTheme ?? "navy",
          validUntil: new Date(Date.now() + 30 * 86400_000),
          branding: await currentBranding(workspaceId),
          createdById: userId,
          changeNote: audit ? "Generated from website audit" : "Created without an audit",
          sections: { create: sections.map((s, i) => ({ key: s.key, title: s.title, body: s.body, included: s.included, sortOrder: i, data: s.data as object | undefined })) },
        },
      },
    },
  });
  if (EARLY_STATUSES.includes(prospect.status)) await db.prospect.update({ where: { id: prospect.id }, data: { status: "PROPOSAL_DRAFT" } });
  await logActivity({ workspaceId, prospectId: prospect.id, userId, type: ACTIVITY_TYPES.PROPOSAL_GENERATED, message: `Proposal generated${audit ? " from website audit" : ""}`, metadata: { proposalId: proposal.id } });
  return proposal;
}

export async function getProposalWithVersion(workspaceId: string, proposalId: string, versionNumber?: number) {
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, workspaceId },
    include: {
      prospect: { include: { contacts: { where: { type: "PERSON_NAME" }, take: 1 } } },
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, locked: true, createdAt: true, changeNote: true, createdBy: { select: { name: true } }, attachments: { select: { id: true, createdAt: true, bytes: true } } } },
    },
  });
  if (!proposal) return null;
  const v = versionNumber ?? proposal.currentVersion;
  const version = await db.proposalVersion.findUnique({
    where: { proposalId_version: { proposalId, version: v } },
    include: { sections: { orderBy: { sortOrder: "asc" } }, attachments: { orderBy: { createdAt: "desc" } } },
  });
  if (!version) return null;
  return { proposal, version };
}

/**
 * Loads the screenshots a version refers to and embeds them as data URIs. Only files of this
 * workspace are read, so an edited proposal can never pull in another workspace's images.
 */
export async function withImages(rv: RenderVersion, workspaceId: string): Promise<RenderVersion> {
  const keys = new Set<string>();
  for (const s of rv.sections) {
    const d = (s.data ?? {}) as { findings?: { screenshot?: string | null }[]; screens?: { desktop: string | null; mobile: string | null } };
    for (const f of d.findings ?? []) if (f.screenshot) keys.add(f.screenshot);
    if (d.screens?.desktop) keys.add(d.screens.desktop);
    if (d.screens?.mobile) keys.add(d.screens.mobile);
  }
  const prefix = `screenshots/${workspaceId}/`;
  const images: Record<string, string> = {};
  for (const key of keys) {
    if (!key.startsWith(prefix) || key.includes("..")) continue;
    try {
      images[key] = `data:image/jpeg;base64,${(await getFile(key)).toString("base64")}`;
    } catch {
      // A deleted screenshot is simply left out.
    }
  }
  return { ...rv, images };
}

export function toRenderVersion(version: NonNullable<Awaited<ReturnType<typeof getProposalWithVersion>>>["version"], fallbackTitle: string): RenderVersion {
  return {
    title: version.title ?? fallbackTitle,
    version: version.version,
    proposalDate: version.proposalDate,
    validUntil: version.validUntil,
    currency: version.currency,
    monthlyPrice: version.monthlyPrice,
    setupFee: version.setupFee,
    durationMonths: version.durationMonths,
    paymentTerms: version.paymentTerms,
    theme: version.theme,
    services: ((version.services as ServiceKey[]) ?? []).filter((s) => SERVICE_KEYS.includes(s)),
    deliverables: (version.deliverables as Deliverable[]) ?? [],
    clientNotes: version.clientNotes,
    includeAppendix: version.includeAppendix,
    branding: (version.branding as Branding) ?? { companyName: null, consultantName: null, email: null, phone: null, website: null, whatsapp: null, logoDataUri: null },
    // Pricing is agreed when a deal is made, not in the proposal, so older drafts drop their pricing section.
    sections: version.sections.filter((s) => s.key !== "pricing").map((s) => ({ key: s.key, title: s.title, body: s.body, included: s.included, data: s.data })),
  };
}

// ───────────────────────────── Saving ─────────────────────────────

const money = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nonnegative().max(1e9).nullable());
const sectionDataSchema = z
  .object({
    findings: z.array(proposalFindingSchema).max(100).optional(),
    phases: z.array(roadmapPhaseSchema).max(10).optional(),
    keywords: z.array(proposalKeywordSchema).max(MAX_PROPOSAL_KEYWORDS).optional(),
    screens: proposalScreensSchema.optional(),
    gbp: proposalGbpSchema.optional(),
    reviews: z.array(proposalReviewSchema).max(5).optional(),
  })
  .nullable()
  .optional();

// Date-only inputs ("2026-10-22") are stored at midday UTC so they show the same calendar day in every time zone.
const dateOnly = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);

export const versionPayloadSchema = z.object({
  title: z.string().trim().min(3).max(200),
  proposalDate: z.preprocess(dateOnly, z.coerce.date()),
  validUntil: z.preprocess((v) => (v === "" || v == null ? null : dateOnly(v)), z.coerce.date().nullable()),
  currency: z.enum(CURRENCIES),
  monthlyPrice: money,
  setupFee: money,
  durationMonths: z.coerce.number().int().min(1).max(60),
  paymentTerms: z.string().max(3000).nullable(),
  roadmap: z.enum(Object.keys(ROADMAPS) as [RoadmapKey, ...RoadmapKey[]]),
  theme: z.enum(THEME_KEYS),
  services: z.array(z.enum(SERVICE_KEYS as [ServiceKey, ...ServiceKey[]])).max(SERVICE_KEYS.length),
  deliverables: z.array(deliverableSchema).max(30),
  clientNotes: z.string().max(5000).nullable(),
  includeAppendix: z.boolean(),
  changeNote: z.string().max(300).optional(),
  sections: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        title: z.string().trim().min(1).max(160),
        body: z.string().max(20000),
        included: z.boolean(),
        data: sectionDataSchema,
      }),
    )
    .min(1)
    .max(40),
});
export type VersionPayload = z.infer<typeof versionPayloadSchema>;

/**
 * Saves edits. An unlocked (never sent) version is updated in place unless a new version is requested.
 * A locked version is never modified: edits always become a new version.
 */
export async function saveProposalVersion(workspaceId: string, userId: string, proposalId: string, baseVersion: number, payload: VersionPayload, asNewVersion: boolean) {
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId }, include: { versions: { select: { version: true } } } });
  if (!proposal) throw new ProposalError("Proposal not found.");
  const base = await db.proposalVersion.findUnique({ where: { proposalId_version: { proposalId, version: baseVersion } } });
  if (!base) throw new ProposalError("Version not found.");
  const latest = Math.max(...proposal.versions.map((v) => v.version));
  const createNew = asNewVersion || base.locked;
  if (!createNew && baseVersion !== latest) throw new ProposalError("Only the latest version can be edited in place. Save as a new version instead.");

  const data = {
    title: payload.title,
    proposalDate: payload.proposalDate,
    validUntil: payload.validUntil,
    currency: payload.currency,
    monthlyPrice: payload.monthlyPrice,
    setupFee: payload.setupFee,
    durationMonths: payload.durationMonths,
    paymentTerms: payload.paymentTerms,
    roadmap: payload.roadmap,
    theme: payload.theme,
    services: payload.services,
    deliverables: payload.deliverables,
    clientNotes: payload.clientNotes,
    includeAppendix: payload.includeAppendix,
    branding: (await currentBranding(workspaceId)) as object,
  };
  const sections = payload.sections.map((s, i) => ({ key: s.key, title: s.title, body: s.body, included: s.included, sortOrder: i, data: (s.data ?? undefined) as object | undefined }));

  let versionNumber = baseVersion;
  await db.$transaction(async (tx) => {
    if (createNew) {
      versionNumber = latest + 1;
      await tx.proposalVersion.create({
        data: {
          ...data,
          proposalId,
          version: versionNumber,
          createdById: userId,
          changeNote: payload.changeNote || (base.locked ? `Edited after v${baseVersion} was sent` : `Revision of v${baseVersion}`),
          sections: { create: sections },
        },
      });
      await tx.proposal.update({ where: { id: proposalId }, data: { currentVersion: versionNumber, title: payload.title, status: proposal.status === "SENT" ? "SENT" : "DRAFT" } });
    } else {
      await tx.proposalVersion.update({ where: { id: base.id }, data: { ...data, ...(payload.changeNote ? { changeNote: payload.changeNote } : {}) } });
      await tx.proposalSection.deleteMany({ where: { versionId: base.id } });
      await tx.proposalSection.createMany({ data: sections.map((s) => ({ ...s, versionId: base.id, data: s.data ?? undefined })) });
      // The stored PDF no longer matches the content.
      await tx.proposalAttachment.deleteMany({ where: { versionId: base.id } });
      await tx.proposal.update({ where: { id: proposalId }, data: { title: payload.title } });
    }
  });
  await logActivity({
    workspaceId,
    prospectId: proposal.prospectId,
    userId,
    type: ACTIVITY_TYPES.PROPOSAL_EDITED,
    message: createNew ? `Proposal saved as version ${versionNumber}${base.locked ? ` (v${baseVersion} was already sent and is unchanged)` : ""}` : `Proposal v${versionNumber} edited`,
    metadata: { proposalId, version: versionNumber },
  });
  return { version: versionNumber, createdNew: createNew, lockedBase: base.locked };
}

export async function duplicateProposal(workspaceId: string, userId: string, proposalId: string) {
  const found = await getProposalWithVersion(workspaceId, proposalId);
  if (!found) throw new ProposalError("Proposal not found.");
  const { proposal, version } = found;
  const copy = await db.proposal.create({
    data: {
      workspaceId,
      prospectId: proposal.prospectId,
      auditId: proposal.auditId,
      title: `${proposal.title} (copy)`,
      versions: {
        create: {
          version: 1,
          title: `${version.title ?? proposal.title} (copy)`,
          currency: version.currency,
          monthlyPrice: version.monthlyPrice,
          setupFee: version.setupFee,
          paymentTerms: version.paymentTerms,
          roadmap: version.roadmap,
          theme: version.theme,
          durationMonths: version.durationMonths,
          services: version.services ?? undefined,
          deliverables: version.deliverables ?? undefined,
          clientNotes: version.clientNotes,
          includeAppendix: version.includeAppendix,
          validUntil: new Date(Date.now() + 30 * 86400_000),
          branding: (await currentBranding(workspaceId)) as object,
          createdById: userId,
          changeNote: `Duplicated from "${proposal.title}" v${version.version}`,
          sections: { create: version.sections.map((s) => ({ key: s.key, title: s.title, body: s.body, included: s.included, sortOrder: s.sortOrder, data: s.data ?? undefined })) },
        },
      },
    },
  });
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: ACTIVITY_TYPES.PROPOSAL_GENERATED, message: `Proposal duplicated from "${proposal.title}"`, metadata: { proposalId: copy.id } });
  return copy;
}

export async function setProposalReady(workspaceId: string, userId: string, proposalId: string, ready: boolean) {
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId }, include: { prospect: true } });
  if (!proposal) throw new ProposalError("Proposal not found.");
  if (proposal.status === "SENT" || proposal.status === "ACCEPTED" || proposal.status === "DECLINED") throw new ProposalError("This proposal has already been sent.");
  await db.proposal.update({ where: { id: proposalId }, data: { status: ready ? "READY" : "DRAFT" } });
  if (ready && ["NEW_PROSPECT", "AUDIT_IN_PROGRESS", "AUDIT_COMPLETED", "PROPOSAL_DRAFT"].includes(proposal.prospect.status)) {
    await db.prospect.update({ where: { id: proposal.prospectId }, data: { status: "PROPOSAL_READY" } });
  }
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: ACTIVITY_TYPES.PROPOSAL_EDITED, message: ready ? "Proposal marked ready to send" : "Proposal moved back to draft" });
}

// ───────────────────────────── PDF ─────────────────────────────

export function pdfFileName(businessName: string, version: number) {
  const slug = businessName.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "proposal";
  return `SEO-Proposal-${slug}-v${version}.pdf`;
}

/** Returns the stored PDF for a version, generating it first if needed. Locked versions are never re-rendered. */
export async function ensurePdf(workspaceId: string, userId: string | null, proposalId: string, versionNumber: number) {
  const found = await getProposalWithVersion(workspaceId, proposalId, versionNumber);
  if (!found) throw new ProposalError("Proposal not found.");
  const { proposal, version } = found;
  const existing = version.attachments.find((a) => a.kind === "PDF");
  if (existing) {
    try {
      return { buffer: await getFile(existing.storageKey), attachment: existing, generated: false };
    } catch {
      if (version.locked) throw new ProposalError("The stored PDF for this sent version is missing.");
      await db.proposalAttachment.delete({ where: { id: existing.id } });
    }
  }
  const rv = await withImages(toRenderVersion(version, proposal.title), workspaceId);
  const html = renderProposalHtml(rv, { businessName: proposal.prospect.businessName, websiteUrl: proposal.prospect.websiteUrl, contactName: proposal.prospect.contacts[0]?.value ?? null });
  const buffer = await htmlToPdf(html, pdfFooterTemplate(rv));
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storageKey = `proposals/${workspaceId}/${proposalId}/v${versionNumber}-${sha256.slice(0, 12)}.pdf`;
  await putFile(storageKey, buffer);
  const attachment = await db.proposalAttachment.create({
    data: { versionId: version.id, kind: "PDF", storageKey, fileName: pdfFileName(proposal.prospect.businessName, versionNumber), bytes: buffer.length, sha256 },
  });
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: ACTIVITY_TYPES.PDF_GENERATED, message: `PDF generated for proposal v${versionNumber}`, metadata: { proposalId, version: versionNumber, bytes: buffer.length } });
  return { buffer, attachment, generated: true };
}
