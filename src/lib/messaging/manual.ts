import "server-only";
import { db } from "../db";
import { ACTIVITY_TYPES, logActivity } from "../activity";
import { recomputeNextFollowUp } from "../prospects";
import { SendError, confirmClickToChatSent, loadComposeContext, markSent, whatsAppDraft } from "./service";
import { clickToChatUrl } from "./whatsapp";

/**
 * WhatsApp happens outside the app, so the user tells the app what happened: "I sent it" (the
 * proposal becomes Sent and reminders are scheduled, as for Gmail) and "they have seen it" (a
 * follow-up is scheduled with a ready WhatsApp message, as when a client opens an emailed link).
 */

const SENT = ["MANUAL_SENT", "SENT", "DELIVERED", "READ", "ACCEPTED"];
const FOLLOW_UP_AFTER_SEEN_MS = 24 * 3600_000;

/** Marks the current version as sent on WhatsApp, whether or not the chat was opened from the app. */
export async function markSentOnWhatsApp(workspaceId: string, userId: string, proposalId: string) {
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId }, include: { prospect: true } });
  if (!proposal) throw new SendError("Proposal not found.");
  if (proposal.prospect.doNotContact) throw new SendError("This prospect has opted out of contact.");
  const version = proposal.currentVersion;
  const already = await db.whatsAppDelivery.findFirst({ where: { proposalId, versionNumber: version, status: { in: SENT } } });
  if (already) return { followUps: 0, already: true };
  // Chat opened from the app but never confirmed: confirm that record.
  const opened = await db.whatsAppDelivery.findFirst({ where: { proposalId, versionNumber: version, status: "MANUAL_OPENED" }, orderBy: { createdAt: "desc" } });
  if (opened) return { ...(await confirmClickToChatSent(workspaceId, userId, opened.id, true)), already: false };

  const draft = await whatsAppDraft(workspaceId, proposalId);
  const recipient = draft?.numbers[0]?.value ?? "number not saved";
  await db.whatsAppDelivery.create({
    data: { proposalId, versionNumber: version, idempotencyKey: `wa-manual:${proposalId}:v${version}`, channelMethod: "CLICK_TO_CHAT", recipient, messagePreview: "Sent from WhatsApp directly (marked as sent in LeadLift)", status: "MANUAL_SENT" },
  });
  const followUps = await markSent(workspaceId, userId, proposalId, version, "WhatsApp", true);
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: ACTIVITY_TYPES.WHATSAPP_SENT, message: `Proposal v${version} marked as sent on WhatsApp${draft?.numbers[0] ? ` to ${recipient}` : ""}` });
  return { followUps, already: false };
}

/**
 * The client has seen the proposal on WhatsApp (blue ticks, or they said so) but not replied:
 * a follow-up is due tomorrow, with the message ready to open in WhatsApp.
 */
export async function markSeenOnWhatsApp(workspaceId: string, userId: string, proposalId: string) {
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId } });
  if (!proposal) throw new SendError("Proposal not found.");
  const sent = await db.whatsAppDelivery.findFirst({ where: { proposalId, status: { in: SENT } } });
  if (!sent) throw new SendError("Mark the proposal as sent on WhatsApp first.");
  const now = new Date();
  await db.whatsAppDelivery.updateMany({ where: { id: sent.id, status: "MANUAL_SENT" }, data: { status: "READ" } });
  if (!proposal.acceptedAt && proposal.status !== "DECLINED" && !(await db.followUp.findFirst({ where: { proposalId, type: "OPENED_NO_REPLY", status: "PENDING" } }))) {
    await db.followUp.create({
      data: { workspaceId, prospectId: proposal.prospectId, proposalId, type: "OPENED_NO_REPLY", dueAt: new Date(now.getTime() + FOLLOW_UP_AFTER_SEEN_MS), note: `Seen on WhatsApp ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. A follow-up message is ready if they have not replied.` },
    });
    await recomputeNextFollowUp(proposal.prospectId);
  }
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: "proposal.seen_whatsapp", message: "Client saw the proposal on WhatsApp (marked by you)" });
  return whatsAppFollowUp(workspaceId, proposalId);
}

/** The ready follow-up for WhatsApp: the message and a chat link to the number it was sent to. */
export async function whatsAppFollowUp(workspaceId: string, proposalId: string) {
  const ctx = await loadComposeContext(workspaceId, proposalId);
  if (!ctx) return null;
  const sent = await db.whatsAppDelivery.findFirst({ where: { proposalId, status: { in: SENT } }, orderBy: { createdAt: "desc" } });
  const number = sent?.recipient.startsWith("+") ? sent.recipient : ((await whatsAppDraft(workspaceId, proposalId))?.numbers[0]?.value ?? null);
  return { message: ctx.followUp.whatsapp, url: number ? clickToChatUrl(number, ctx.followUp.whatsapp) : null };
}

/** WhatsApp state of a proposal for the proposal page. */
export async function whatsAppState(proposalId: string) {
  const rows = await db.whatsAppDelivery.findMany({ where: { proposalId }, orderBy: { createdAt: "desc" } });
  const sent = rows.find((r) => SENT.includes(r.status)) ?? null;
  return { sentAt: sent?.createdAt ?? null, seen: sent?.status === "READ", recipient: sent?.recipient ?? null, openedNotConfirmed: !sent && rows.some((r) => r.status === "MANUAL_OPENED") };
}
