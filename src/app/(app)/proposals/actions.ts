"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { KEYWORD_PLAN_INTRO, buildRoadmap, keywordSectionBody, type SourceFinding } from "@/lib/proposals/generate";
import { PdfError } from "@/lib/proposals/pdf";
import {
  ProposalError,
  createProposal,
  duplicateProposal,
  ensurePdf,
  proposalKeywords,
  saveProposalVersion,
  setProposalReady,
  versionPayloadSchema,
} from "@/lib/proposals/service";
import type { ProposalKeyword, RoadmapKey, RoadmapPhase, ServiceKey } from "@/lib/proposals/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof ProposalError || e instanceof PdfError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("proposals", e)) };
}

export async function createProposalAction(formData: FormData) {
  const session = await requireSession();
  const prospectId = String(formData.get("prospectId") ?? "");
  const auditId = String(formData.get("auditId") ?? "") || null;
  const proposal = await createProposal(session.workspace.id, session.user.id, { prospectId, auditId });
  revalidatePath("/proposals");
  redirect(`/proposals/${proposal.id}/edit`);
}

export async function saveProposalAction(proposalId: string, baseVersion: number, payload: unknown, asNewVersion: boolean): Promise<Result<{ version: number; createdNew: boolean; lockedBase: boolean }>> {
  const session = await requireSession();
  const parsed = versionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Please check “${issue.path.join(" › ")}”: ${issue.message}` };
  }
  try {
    const r = await saveProposalVersion(session.workspace.id, session.user.id, proposalId, baseVersion, parsed.data, asNewVersion);
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}

/** Recomputes the roadmap phases for a preset from the linked audit's findings. */
export async function roadmapForPresetAction(proposalId: string, roadmap: RoadmapKey, services: ServiceKey[]): Promise<Result<{ phases: RoadmapPhase[] }>> {
  const session = await requireSession();
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId: session.workspace.id } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  const findings = proposal.auditId
    ? (await db.auditFinding.findMany({ where: { auditId: proposal.auditId }, include: { evidence: { take: 1 } } })).map((f) => ({ ...f, affectedUrls: f.affectedUrls as string[] }) as SourceFinding)
    : [];
  return { ok: true, phases: buildRoadmap(roadmap, findings.filter((f) => f.includeInProposal && f.resolutionStatus !== "DISMISSED").sort((a, b) => b.priority - a.priority), services) };
}

/** The prospect's current proposal keywords from the Research tab, for the editor's "reload" button. */
export async function keywordsFromResearchAction(proposalId: string): Promise<Result<{ keywords: ProposalKeyword[]; chosen: boolean; body: string | null; planIntro: string }>> {
  const session = await requireSession();
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId: session.workspace.id }, include: { prospect: true } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  const r = await proposalKeywords(session.workspace.id, proposal.prospectId);
  return { ok: true, ...r, body: r.keywords.length ? keywordSectionBody(proposal.prospect.businessName, proposal.prospect.city, r.keywords) : null, planIntro: KEYWORD_PLAN_INTRO };
}

export async function duplicateProposalAction(proposalId: string) {
  const session = await requireSession();
  const copy = await duplicateProposal(session.workspace.id, session.user.id, proposalId);
  revalidatePath("/proposals");
  redirect(`/proposals/${copy.id}/edit`);
}

export async function setReadyAction(proposalId: string, ready: boolean): Promise<Result> {
  const session = await requireSession();
  try {
    await setProposalReady(session.workspace.id, session.user.id, proposalId, ready);
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function generatePdfAction(proposalId: string, version: number): Promise<Result<{ generated: boolean; bytes: number }>> {
  const session = await requireSession();
  try {
    const r = await ensurePdf(session.workspace.id, session.user.id, proposalId, version);
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, generated: r.generated, bytes: r.attachment.bytes };
  } catch (e) {
    return fail(e);
  }
}
