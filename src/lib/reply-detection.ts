import "server-only";
import { db } from "./db";
import { logger } from "./log";
import { notify } from "./notifications";
import { logActivity } from "./activity";
import { GoogleApiError, googleJson, googleToken } from "./google-api";

/**
 * Gmail reply detection (read-only): every 15 minutes the inbox is searched for recent messages
 * from a prospect's email address. A reply stops that prospect's pending follow-ups and queued
 * campaign emails, and moves an early-stage deal to "Replied". Nothing in Gmail is changed.
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const log = logger("reply-detection");
/** Deals in these stages move to "Replied"; later stages (meeting, negotiation, won…) are left alone. */
const MOVE_FROM = ["NEW_PROSPECT", "AUDIT_COMPLETED", "PROPOSAL_DRAFT", "PROPOSAL_READY", "PROPOSAL_SENT", "FOLLOW_UP_DUE"];

/** Gmail snippets come HTML-escaped. */
export const unescapeHtml = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** "Ali Khan <Ali@Example.com>" → "ali@example.com" */
export function emailOf(from: string) {
  const m = from.match(/<([^>]+)>/) ?? from.match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1].trim().toLowerCase() : null;
}

async function ensureRepliedStatus(workspaceId: string) {
  const sent = await db.pipelineStatus.findUnique({ where: { workspaceId_key: { workspaceId, key: "PROPOSAL_SENT" } }, select: { sortOrder: true } });
  await db.pipelineStatus.upsert({ where: { workspaceId_key: { workspaceId, key: "REPLIED" } }, create: { workspaceId, key: "REPLIED", label: "Replied", sortOrder: sent?.sortOrder ?? 6, isSystem: true }, update: {} });
}

/** What happens when a prospect replies; returns what was stopped. */
export async function handleReply(workspaceId: string, prospectId: string, r: { messageId: string; threadId?: string | null; fromEmail: string; subject?: string | null; snippet?: string | null; receivedAt: Date }) {
  const exists = await db.gmailReply.findUnique({ where: { workspaceId_messageId: { workspaceId, messageId: r.messageId } }, select: { id: true } });
  if (exists) return null;
  const prospect = await db.prospect.findFirst({ where: { id: prospectId, workspaceId } });
  if (!prospect) return null;
  await db.gmailReply.create({ data: { workspaceId, prospectId, messageId: r.messageId, threadId: r.threadId ?? null, fromEmail: r.fromEmail, subject: r.subject?.slice(0, 300) ?? null, snippet: r.snippet?.slice(0, 500) ?? null, receivedAt: r.receivedAt } });
  const followUps = await db.followUp.updateMany({ where: { workspaceId, prospectId, status: "PENDING" }, data: { status: "CANCELLED", completedAt: new Date(), result: "Stopped: the client replied by email" } });
  const queued = await db.campaignRecipient.updateMany({ where: { status: "QUEUED", proposal: { prospectId } }, data: { status: "SKIPPED", reason: "The client replied" } });
  const move = MOVE_FROM.includes(prospect.status);
  if (move) await ensureRepliedStatus(workspaceId);
  await db.prospect.update({ where: { id: prospectId }, data: { repliedAt: r.receivedAt, lastActivityAt: new Date(), ...(move ? { status: "REPLIED" } : {}) } });
  await logActivity({ workspaceId, prospectId, type: "email.reply_detected", message: `Reply from ${r.fromEmail}${r.subject ? `: “${r.subject.slice(0, 120)}”` : ""}${followUps.count ? ` — ${followUps.count} follow-up${followUps.count === 1 ? "" : "s"} stopped` : ""}` });
  await notify({ workspaceId, title: `${prospect.businessName} replied`, body: r.snippet?.slice(0, 200) ?? r.subject ?? undefined, link: `/prospects/${prospectId}` });
  return { followUps: followUps.count, campaignEmails: queued.count, moved: move };
}

type ListResponse = { messages?: { id: string; threadId: string }[] };
type MessageResponse = { id: string; threadId: string; snippet?: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };

/** Looks for replies in the last few days; returns how many were new. */
export async function checkReplies(workspaceId: string, fetchImpl: typeof fetch = fetch) {
  const tok = await googleToken(workspaceId, "GMAIL_REPLIES", fetchImpl);
  if (!tok) return 0;
  const contacts = await db.prospectContact.findMany({ where: { type: "EMAIL", prospect: { workspaceId, doNotContact: false } }, select: { value: true, prospectId: true } });
  const byEmail = new Map(contacts.map((c) => [c.value.trim().toLowerCase(), c.prospectId]));
  if (!byEmail.size) return 0;
  const list = await googleJson<ListResponse>(tok, `${GMAIL}/messages?maxResults=50&q=${encodeURIComponent("in:inbox newer_than:3d -from:me")}`, {}, fetchImpl);
  const seen = new Set((await db.gmailReply.findMany({ where: { workspaceId, messageId: { in: (list.messages ?? []).map((m) => m.id) } }, select: { messageId: true } })).map((m) => m.messageId));
  let found = 0;
  for (const m of list.messages ?? []) {
    if (seen.has(m.id)) continue;
    const msg = await googleJson<MessageResponse>(tok, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, {}, fetchImpl);
    const header = (n: string) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? null;
    const from = emailOf(header("From") ?? "");
    const prospectId = from ? byEmail.get(from) : undefined;
    if (!prospectId || !from) continue;
    const done = await handleReply(workspaceId, prospectId, { messageId: msg.id, threadId: msg.threadId, fromEmail: from, subject: header("Subject"), snippet: msg.snippet ? unescapeHtml(msg.snippet) : null, receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date() });
    if (done) found++;
  }
  return found;
}

export async function runReplyChecks() {
  const ws = await db.integrationConnection.findMany({ where: { provider: "GMAIL_REPLIES", status: "CONNECTED", encryptedSecret: { not: null } }, select: { workspaceId: true } });
  for (const w of ws) {
    await checkReplies(w.workspaceId).catch(async (e) => {
      log.warn("reply check failed", { workspaceId: w.workspaceId, reason: (e as Error).message });
      if (e instanceof GoogleApiError) await db.integrationConnection.update({ where: { workspaceId_provider: { workspaceId: w.workspaceId, provider: "GMAIL_REPLIES" } }, data: { lastError: e.message.slice(0, 500) } }).catch(() => {});
    });
  }
}
