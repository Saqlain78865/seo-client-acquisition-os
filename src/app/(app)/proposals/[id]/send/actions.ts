"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ShareError, createShareLink, revokeShareLink } from "@/lib/messaging/share";
import { SendError, saveProposalEmailDraft, sendProposalEmail, type EmailSendInput } from "@/lib/messaging/service";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; recovery?: string };

async function fail(e: unknown): Promise<{ ok: false; error: string; recovery?: string }> {
  if (e instanceof SendError) return { ok: false, error: e.message, recovery: e.recovery };
  if (e instanceof ShareError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Nothing was sent.", await reportError("send", e)) };
}

function refresh(proposalId: string) {
  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath(`/proposals/${proposalId}/send`);
}

export async function sendEmailAction(input: EmailSendInput): Promise<Result<{ duplicate: boolean; followUps: number; sender: string | null }>> {
  const session = await requireSession();
  try {
    const r = await sendProposalEmail(session.workspace.id, session.user.id, input);
    refresh(input.proposalId);
    return { ok: true, duplicate: r.duplicate, followUps: r.followUps, sender: r.delivery.sender };
  } catch (e) {
    refresh(input.proposalId);
    return fail(e);
  }
}

export async function saveDraftAction(input: EmailSendInput): Promise<Result<{ sender: string | null }>> {
  const session = await requireSession();
  try {
    const d = await saveProposalEmailDraft(session.workspace.id, session.user.id, input);
    refresh(input.proposalId);
    return { ok: true, sender: d.sender };
  } catch (e) {
    return fail(e);
  }
}

export async function createShareAction(proposalId: string, days: number): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  try {
    const r = await createShareLink(session.workspace.id, session.user.id, proposalId, days);
    refresh(proposalId);
    return { ok: true, url: r.url };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeShareAction(proposalId: string): Promise<Result> {
  const session = await requireSession();
  try {
    await revokeShareLink(session.workspace.id, session.user.id, proposalId);
    refresh(proposalId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
