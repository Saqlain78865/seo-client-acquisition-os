"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireRole, requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { auditRequestSchema } from "@/lib/validation";
import { AuditRequestError, retryAudit, startAudit, startAuditFromGbpLink } from "@/lib/audit/service";
import { isGbpLink } from "@/lib/research/gbp-link";
import { startBulkAudit } from "@/lib/audit/bulk";

export type AuditFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

export async function startAuditAction(_: AuditFormState, formData: FormData): Promise<AuditFormState> {
  const session = await requireSession();
  const parsed = auditRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  let auditId: string;
  try {
    ({
      audit: { id: auditId },
    } = await (isGbpLink(parsed.data.websiteUrl) ? startAuditFromGbpLink : startAudit)(session.workspace.id, session.user.id, parsed.data));
  } catch (e) {
    if (e instanceof AuditRequestError) return { fieldErrors: { websiteUrl: [e.message] } };
    return { error: withReference("The audit could not be started. Please try again.", await reportError("audits", e)) };
  }
  revalidatePath("/audits");
  redirect(`/audits/${auditId}`);
}

export async function retryAuditAction(auditId: string) {
  const session = await requireSession();
  try {
    await retryAudit(session.workspace.id, auditId);
  } catch (e) {
    if (e instanceof AuditRequestError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/audits/${auditId}`);
  return { ok: true };
}

const findingIntent = z.enum(["accept", "dismiss", "reopen", "resolve", "include", "exclude"]);

export async function updateFindingAction(findingId: string, formData: FormData) {
  const session = await requireSession();
  const intent = findingIntent.parse(formData.get("intent"));
  const f = await db.auditFinding.findFirst({ where: { id: findingId, audit: { workspaceId: session.workspace.id } } });
  if (!f) throw new ForbiddenError("Finding not found.");
  const data =
    intent === "include" || intent === "exclude"
      ? { includeInProposal: intent === "include" }
      : { resolutionStatus: { accept: "ACCEPTED", dismiss: "DISMISSED", reopen: "OPEN", resolve: "RESOLVED" }[intent], ...(intent === "dismiss" ? { includeInProposal: false } : {}) };
  await db.auditFinding.update({ where: { id: f.id }, data });
  revalidatePath(`/audits/${f.auditId}`);
}

export async function deleteAuditAction(auditId: string) {
  const session = await requireRole("ADMIN");
  const audit = await db.websiteAudit.findFirst({ where: { id: auditId, workspaceId: session.workspace.id } });
  if (!audit) throw new ForbiddenError("Audit not found.");
  if (audit.status === "RUNNING" || audit.status === "QUEUED") throw new ForbiddenError("Wait for the audit to finish before deleting it.");
  await db.websiteAudit.delete({ where: { id: auditId } });
  revalidatePath("/audits");
  redirect(`/prospects/${audit.prospectId}`);
}

export type BulkFormState = { error?: string } | undefined;

export async function startBulkAuditAction(_: BulkFormState, formData: FormData): Promise<BulkFormState> {
  const session = await requireSession();
  const sites = String(formData.get("sites") ?? "").slice(0, 20_000);
  const name = String(formData.get("name") ?? "");
  const autoProposal = formData.get("autoProposal") === "on";
  let batchId: string;
  try {
    ({
      batch: { id: batchId },
    } = await startBulkAudit(session.workspace.id, session.user.id, { name, sites, autoProposal }));
  } catch (e) {
    if (e instanceof AuditRequestError) return { error: e.message };
    return { error: withReference("The bulk audit could not be started. Please try again.", await reportError("audits", e)) };
  }
  revalidatePath("/audits/bulk");
  redirect(`/audits/bulk/${batchId}`);
}
