"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { SendError, confirmClickToChatSent, openClickToChat, whatsAppDraft } from "@/lib/messaging/service";
import { toWaNumber } from "@/lib/messaging/whatsapp";
import { markSeenOnWhatsApp, markSentOnWhatsApp } from "@/lib/messaging/manual";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof SendError) return { ok: false, error: e.recovery ? `${e.message} ${e.recovery}` : e.message };
  return { ok: false, error: withReference("Something went wrong.", await reportError("whatsapp", e)) };
}

/**
 * Opens the client's WhatsApp chat (wa.me click-to-chat) with the message ready, and returns the
 * PDF link so it can be attached by hand. Nothing counts as sent until the user confirms it.
 */
export async function openWhatsAppAction(proposalId: string, number?: string, message?: string): Promise<Result<{ url: string; deliveryId: string; pdfUrl: string }>> {
  const session = await requireSession();
  try {
    const draft = await whatsAppDraft(session.workspace.id, proposalId);
    if (!draft) return { ok: false, error: "Proposal not found." };
    const to = number ?? draft.numbers[0]?.value;
    if (!to) return { ok: false, error: "No WhatsApp number was found on this website. Add one on the prospect page." };
    const r = await openClickToChat(session.workspace.id, session.user.id, {
      proposalId,
      version: draft.version,
      to,
      message: message?.trim() || draft.message,
      // One record per proposal version and number: opening the chat again does not add rows.
      idempotencyKey: `wa:${proposalId}:v${draft.version}:${toWaNumber(to) ?? to}`,
      scheduleFollowUps: true,
      // The person chose this number and clicked the button themselves.
      confirmUnverified: true,
    });
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, url: r.url, deliveryId: r.delivery.id, pdfUrl: draft.pdfUrl };
  } catch (e) {
    return fail(e);
  }
}

/** "I sent it on WhatsApp" — for a proposal sent from the phone or WhatsApp directly. */
export async function markSentOnWhatsAppAction(proposalId: string): Promise<Result<{ followUps: number; already: boolean }>> {
  const session = await requireSession();
  try {
    const r = await markSentOnWhatsApp(session.workspace.id, session.user.id, proposalId);
    revalidatePath(`/proposals/${proposalId}`);
    revalidatePath("/proposals");
    return { ok: true, followUps: r.followUps, already: r.already };
  } catch (e) {
    return fail(e);
  }
}

/** "They've seen it" on WhatsApp: schedules the follow-up and returns the ready message. */
export async function markSeenOnWhatsAppAction(proposalId: string): Promise<Result<{ message: string; url: string | null }>> {
  const session = await requireSession();
  try {
    const r = await markSeenOnWhatsApp(session.workspace.id, session.user.id, proposalId);
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, message: r?.message ?? "", url: r?.url ?? null };
  } catch (e) {
    return fail(e);
  }
}

/** The user confirms they pressed Send in WhatsApp: the proposal is marked sent and reminders are scheduled. */
export async function confirmWhatsAppAction(proposalId: string, deliveryId: string): Promise<Result<{ followUps: number }>> {
  const session = await requireSession();
  try {
    const r = await confirmClickToChatSent(session.workspace.id, session.user.id, deliveryId, true);
    revalidatePath(`/proposals/${proposalId}`);
    revalidatePath("/audits/bulk", "layout");
    return { ok: true, followUps: r.followUps };
  } catch (e) {
    return fail(e);
  }
}
