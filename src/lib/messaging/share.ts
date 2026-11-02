import "server-only";
import QRCode from "qrcode";
import { db } from "../db";
import { randomToken } from "../crypto";
import { logActivity } from "../activity";
import { notify } from "../notifications";
import { recomputeNextFollowUp } from "../prospects";
import { markWon } from "../kickoff";

/** Follow-up types that end once the client replies on the link. */
const REPLY_ENDS = ["PROPOSAL_REMINDER", "REVIEW_UNANSWERED", "OPENED_NO_REPLY"];
const FOLLOW_UP_AFTER_OPEN_MS = 24 * 3600_000;

export class ShareError extends Error {}

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function shareUrl(token: string) {
  return `${appUrl()}/p/${token}`;
}

/**
 * Creates (or replaces) the client link for the proposal's current version. The token is random
 * (192 bits) and only grants read access to that one version. Sharing locks the version so the
 * client always sees exactly what was shared; later edits become a new version.
 */
export async function createShareLink(workspaceId: string, userId: string, proposalId: string, days: number) {
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId } });
  if (!proposal) throw new ShareError("Proposal not found.");
  const validDays = Math.min(Math.max(Math.round(days), 1), 90);
  const token = randomToken(24);
  await db.$transaction([
    db.proposalVersion.update({ where: { proposalId_version: { proposalId, version: proposal.currentVersion } }, data: { locked: true } }),
    db.proposal.update({
      where: { id: proposalId },
      data: { shareToken: token, shareExpiresAt: new Date(Date.now() + validDays * 86400_000), shareRevoked: false, shareVersion: proposal.currentVersion, shareViews: 0, shareLastViewedAt: null },
    }),
  ]);
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: "proposal.share_created", message: `Share link created for v${proposal.currentVersion} (expires in ${validDays} days)` });
  return { url: shareUrl(token), version: proposal.currentVersion };
}

export async function revokeShareLink(workspaceId: string, userId: string, proposalId: string) {
  const proposal = await db.proposal.findFirst({ where: { id: proposalId, workspaceId } });
  if (!proposal) throw new ShareError("Proposal not found.");
  await db.proposal.update({ where: { id: proposalId }, data: { shareRevoked: true } });
  await logActivity({ workspaceId, prospectId: proposal.prospectId, userId, type: "proposal.share_revoked", message: "Share link revoked" });
}

export type ShareState = "ACTIVE" | "EXPIRED" | "REVOKED" | "NONE";
export function shareState(p: { shareToken: string | null; shareRevoked: boolean; shareExpiresAt: Date | null }): ShareState {
  if (!p.shareToken) return "NONE";
  if (p.shareRevoked) return "REVOKED";
  if (p.shareExpiresAt && p.shareExpiresAt < new Date()) return "EXPIRED";
  return "ACTIVE";
}

/** Looks up a public token. Returns null for unknown, revoked or expired links (no detail leaks to the visitor). */
export async function resolveShareToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const proposal = await db.proposal.findUnique({ where: { shareToken: token }, include: { prospect: { include: { contacts: { where: { type: "PERSON_NAME" }, take: 1 } } } } });
  if (!proposal || shareState(proposal) !== "ACTIVE" || proposal.shareVersion == null) return null;
  return proposal;
}

/** Counts a view; activity and the "opened" alert are logged at most once every 6 hours to keep history readable. */
export async function recordShareView(proposalId: string) {
  const p = await db.proposal.update({
    where: { id: proposalId },
    data: { shareViews: { increment: 1 } },
    select: { shareLastViewedAt: true, workspaceId: true, prospectId: true, shareViews: true, status: true, acceptedAt: true, prospect: { select: { businessName: true } } },
  });
  const now = new Date();
  await db.proposal.update({ where: { id: proposalId }, data: { shareLastViewedAt: now } });
  if (!p.shareLastViewedAt || now.getTime() - p.shareLastViewedAt.getTime() > 6 * 3600_000) {
    await logActivity({ workspaceId: p.workspaceId, prospectId: p.prospectId, type: "proposal.viewed", message: `Proposal opened via share link (${p.shareViews} view${p.shareViews === 1 ? "" : "s"})` });
    const awaitingReply = !p.acceptedAt && p.status !== "DECLINED";
    // First open: schedule a follow-up for tomorrow with a ready-made draft (unless one is already pending).
    if (awaitingReply && !(await db.followUp.findFirst({ where: { proposalId, type: "OPENED_NO_REPLY", status: "PENDING" } }))) {
      await db.followUp.create({
        data: { workspaceId: p.workspaceId, prospectId: p.prospectId, proposalId, type: "OPENED_NO_REPLY", dueAt: new Date(now.getTime() + FOLLOW_UP_AFTER_OPEN_MS), note: `Proposal opened ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. A follow-up draft is ready if they have not replied.` },
      });
      await recomputeNextFollowUp(p.prospectId);
    }
    await notify({
      workspaceId: p.workspaceId,
      title: `${p.prospect.businessName} opened your proposal`,
      body: awaitingReply ? `${p.shareViews === 1 ? "First view." : `Viewed ${p.shareViews} times.`} A follow-up email draft is ready — send it tomorrow if they have not replied.` : `Viewed ${p.shareViews} times so far.`,
      link: awaitingReply ? `/proposals/${proposalId}/send?followup=1` : `/proposals/${proposalId}`,
    });
  }
}

export class ResponseError extends Error {}

/** A drawn signature: a PNG data URI of reasonable size. */
const SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
export const MAX_SIGNATURE_CHARS = 200_000;

/**
 * A reply from the client on the public link: accepting the proposal (with a drawn signature) or
 * asking a question. Accepting marks the proposal ACCEPTED, records the deal as won, prepares the
 * kickoff checklist and cancels the pending proposal reminders.
 */
export async function respondToProposal(token: string, input: { kind: "ACCEPT" | "QUESTION"; name: string; contact?: string; message?: string; signature?: string }) {
  const proposal = await resolveShareToken(token);
  if (!proposal) throw new ResponseError("This link is no longer active. Please contact the sender.");
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new ResponseError("Please enter your name.");
  const recent = await db.proposalResponse.count({ where: { proposalId: proposal.id, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= 5) throw new ResponseError("Thanks — we already received your messages. We will be in touch soon.");
  if (input.kind === "ACCEPT" && proposal.acceptedAt) return { alreadyAccepted: true };
  const signature = input.kind === "ACCEPT" ? input.signature?.trim() : undefined;
  if (input.kind === "ACCEPT" && (!signature || signature.length > MAX_SIGNATURE_CHARS || !SIGNATURE.test(signature))) throw new ResponseError("Please sign in the box to accept.");

  await db.proposalResponse.create({
    data: { proposalId: proposal.id, kind: input.kind, name, contact: input.contact?.trim().slice(0, 200) || null, message: input.message?.trim().slice(0, 3000) || null, signature: signature ?? null, version: proposal.shareVersion! },
  });
  const who = `${name}${input.contact ? ` (${input.contact.trim().slice(0, 200)})` : ""}`;
  if (input.kind === "ACCEPT") {
    await db.$transaction([
      db.proposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } }),
      db.followUp.updateMany({ where: { proposalId: proposal.id, status: "PENDING", type: { in: REPLY_ENDS } }, data: { status: "CANCELLED", result: "Client accepted the proposal online" } }),
    ]);
    await logActivity({ workspaceId: proposal.workspaceId, prospectId: proposal.prospectId, type: "proposal.accepted_online", message: `Proposal v${proposal.shareVersion} accepted and signed online by ${who}` });
    // A prospect already closed (lost / not interested) is not reopened automatically.
    const closed = proposal.prospect.status !== "WON" && (await db.pipelineStatus.findFirst({ where: { workspaceId: proposal.workspaceId, key: proposal.prospect.status, isTerminal: true } }));
    const won = closed ? null : await markWon(proposal.workspaceId, proposal.prospectId, { proposalId: proposal.id, reason: `proposal accepted online by ${who}` });
    await notify({
      workspaceId: proposal.workspaceId,
      title: `🎉 ${proposal.prospect.businessName} accepted your proposal`,
      body: `Accepted by ${who}. The signed service agreement is ready to download on the proposal.${input.message ? ` Message: ${input.message.slice(0, 300)}` : ""}${won ? ` The deal is marked as won${won.kickoffCreated ? ` and a ${won.kickoffCreated}-step kickoff checklist is ready` : ""}. Add the agreed value on the prospect page.` : ""}`,
      link: won ? `/prospects/${proposal.prospectId}` : `/proposals/${proposal.id}`,
    });
  } else {
    // They replied, so the "opened, no reply" nudge is no longer needed; regular reminders stay.
    await db.followUp.updateMany({ where: { proposalId: proposal.id, status: "PENDING", type: "OPENED_NO_REPLY" }, data: { status: "CANCELLED", result: "Client asked a question on the link" } });
    await logActivity({ workspaceId: proposal.workspaceId, prospectId: proposal.prospectId, type: "proposal.question", message: `Question from ${who} on the proposal link` });
    await notify({ workspaceId: proposal.workspaceId, title: `${proposal.prospect.businessName} sent a question`, body: `${who}: ${(input.message ?? "").slice(0, 400)}`, link: `/proposals/${proposal.id}` });
  }
  await recomputeNextFollowUp(proposal.prospectId);
  return { alreadyAccepted: false };
}

export async function qrDataUri(text: string) {
  return QRCode.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: "M", color: { dark: "#0b1f3a", light: "#ffffff" } });
}
