import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { ACTIVITY_TYPES, logActivity } from "../activity";
import { getCredentials } from "../integrations";
import { isValidEmailFormat } from "../contacts";
import { recomputeNextFollowUp } from "../prospects";
import { ensurePdf } from "../proposals/service";
import type { ProposalFinding } from "../proposals/types";
import { EmailError, saveDraft, sendEmail } from "./email";
import { renderTemplate, summariseFindings, type TemplateVars } from "./templates";
import { WhatsAppError, clickToChatUrl, sendTemplateMessage, toWaNumber, type CloudConfig, type StatusUpdate } from "./whatsapp";
import { shareState, shareUrl } from "./share";
import { followUpDraft } from "./followup";

export class SendError extends Error {
  constructor(
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
  }
}

const EARLY = ["NEW_PROSPECT", "AUDIT_IN_PROGRESS", "AUDIT_COMPLETED", "PROPOSAL_DRAFT", "PROPOSAL_READY"];
const UNRESOLVED = /\{\{\s*\w+\s*\}\}/;

/** Everything the compose screens need, in one query set. Contains no credentials. */
export async function loadComposeContext(workspaceId: string, proposalId: string) {
  const proposal = await db.proposal.findFirst({
    where: { id: proposalId, workspaceId },
    include: { prospect: { include: { contacts: { orderBy: [{ isPreferred: "desc" }, { verified: "desc" }] } } } },
  });
  if (!proposal) return null;
  const version = await db.proposalVersion.findUniqueOrThrow({ where: { proposalId_version: { proposalId, version: proposal.currentVersion } }, include: { sections: { where: { key: "key_findings" } } } });
  const [settings, templates] = await Promise.all([
    db.workspaceSettings.findUnique({ where: { workspaceId } }),
    db.messageTemplate.findMany({ where: { workspaceId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const findings = ((version.sections[0]?.data as { findings?: ProposalFinding[] } | null)?.findings ?? []).map((f) => f.title);
  const share = shareState(proposal) === "ACTIVE" && proposal.shareVersion === proposal.currentVersion ? shareUrl(proposal.shareToken!) : null;
  const person = proposal.prospect.contacts.find((c) => c.type === "PERSON_NAME");
  const vars: TemplateVars = {
    clientName: person?.value.split(" ")[0] ?? "there",
    businessName: proposal.prospect.businessName,
    websiteUrl: proposal.prospect.websiteUrl,
    proposalTitle: version.title ?? proposal.title,
    proposalDate: version.proposalDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    proposalLink: share,
    auditSummary: summariseFindings(findings),
    consultantName: settings?.consultantName ?? null,
    companyName: settings?.companyName ?? null,
  };
  const lastSent = await db.emailDelivery.findFirst({ where: { proposalId, status: "ACCEPTED" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  const sentOn = lastSent?.sentAt ?? null;
  const followUp = followUpDraft({
    firstName: person?.value.split(" ")[0] ?? null,
    businessName: proposal.prospect.businessName,
    sentOn: sentOn ? sentOn.toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null,
    shareLink: share,
    findingsSummary: vars.auditSummary ?? "",
    consultantName: settings?.consultantName ?? null,
    companyName: settings?.companyName ?? null,
  });
  return { proposal, version, prospect: proposal.prospect, contacts: proposal.prospect.contacts, templates, vars, shareLink: share, followUp };
}

/** Locks the version and moves statuses forward after a confirmed send. Creates reminder follow-ups if asked. */
async function markSent(workspaceId: string, userId: string | null, proposalId: string, version: number, channel: string, scheduleFollowUps: boolean) {
  const proposal = await db.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { prospect: true } });
  await db.$transaction([
    db.proposalVersion.update({ where: { proposalId_version: { proposalId, version } }, data: { locked: true } }),
    db.proposal.update({ where: { id: proposalId }, data: { status: proposal.status === "ACCEPTED" || proposal.status === "DECLINED" ? proposal.status : "SENT" } }),
    ...(EARLY.includes(proposal.prospect.status) ? [db.prospect.update({ where: { id: proposal.prospectId }, data: { status: "PROPOSAL_SENT" } })] : []),
  ]);
  let created = 0;
  if (scheduleFollowUps) {
    const settings = await db.workspaceSettings.findUnique({ where: { workspaceId } });
    const days = (settings?.followUpDefaultDays ?? "3,7")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isFinite(d) && d > 0 && d <= 90);
    for (const d of days) {
      await db.followUp.create({ data: { workspaceId, prospectId: proposal.prospectId, proposalId, type: "PROPOSAL_REMINDER", dueAt: new Date(Date.now() + d * 86400_000), note: `Reminder: check in about the proposal sent by ${channel} (day ${d})` } });
      created++;
    }
    if (created) await recomputeNextFollowUp(proposal.prospectId);
  }
  return created;
}

function checkContactable(prospect: { doNotContact: boolean; doNotContactReason: string | null }) {
  if (prospect.doNotContact) throw new SendError(`This prospect has opted out of contact${prospect.doNotContactReason ? ` (${prospect.doNotContactReason})` : ""}.`, "Remove the opt-out on the prospect page only if they have agreed to be contacted again.");
}

// ───────────────────────────── Email ─────────────────────────────

export type EmailSendInput = {
  proposalId: string;
  version: number;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  templateId?: string | null;
  idempotencyKey: string;
  scheduleFollowUps: boolean;
  confirmUnverified: boolean;
};

async function prepareEmail(workspaceId: string, input: EmailSendInput) {
  const ctx = await loadComposeContext(workspaceId, input.proposalId);
  if (!ctx) throw new SendError("Proposal not found.");
  if (input.version !== ctx.proposal.currentVersion) throw new SendError(`A newer version (v${ctx.proposal.currentVersion}) exists. Reload and send the latest version.`);
  checkContactable(ctx.prospect);
  const to = input.to.trim().toLowerCase();
  const all = [to, ...input.cc, ...input.bcc].map((x) => x.trim()).filter(Boolean);
  const bad = all.filter((x) => !isValidEmailFormat(x));
  if (bad.length) throw new SendError(`Invalid email address: ${bad.join(", ")}`);
  const known = ctx.contacts.find((c) => c.type === "EMAIL" && c.value === to);
  if ((!known || !known.verified) && !input.confirmUnverified) {
    throw new SendError(known ? `${to} has not been verified yet.` : `${to} is not one of this prospect's saved contacts.`, "Verify the address on the prospect page, or tick the confirmation box to send anyway.");
  }
  if (!input.subject.trim()) throw new SendError("Add a subject.");
  if (UNRESOLVED.test(input.subject) || UNRESOLVED.test(input.body)) throw new SendError("Some {{placeholders}} are still empty. Fill them in or remove them before sending.");
  const pdf = await ensurePdf(workspaceId, null, input.proposalId, input.version);
  return {
    ctx,
    to,
    mail: {
      to,
      cc: input.cc.filter(Boolean),
      bcc: input.bcc.filter(Boolean),
      subject: input.subject.trim(),
      text: input.body,
      attachments: [{ filename: pdf.attachment.fileName, content: pdf.buffer, contentType: "application/pdf" }],
    },
  };
}

/**
 * Sends the proposal email once. The same idempotency key never sends twice: a repeated request
 * returns the earlier result. Only a provider-accepted send locks the version and marks it sent.
 */
export async function sendProposalEmail(workspaceId: string, userId: string, input: EmailSendInput) {
  const existing = await db.emailDelivery.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && existing.status === "ACCEPTED") return { delivery: existing, duplicate: true, followUps: 0 };
  if (existing && existing.status === "SENDING" && Date.now() - existing.createdAt.getTime() < 120_000) throw new SendError("This email is already being sent. Wait a moment and refresh.");
  if (existing && (await db.proposal.count({ where: { id: existing.proposalId, workspaceId } })) === 0) throw new SendError("Proposal not found.");

  const { ctx, to, mail } = await prepareEmail(workspaceId, input);
  const bodySha256 = createHash("sha256").update(input.body).digest("hex");
  const base = { proposalId: input.proposalId, versionNumber: input.version, recipient: to, cc: mail.cc.join(", ") || null, bcc: mail.bcc.join(", ") || null, subject: mail.subject, templateId: input.templateId ?? null, bodySha256 };
  let delivery = existing
    ? await db.emailDelivery.update({ where: { id: existing.id }, data: { ...base, status: "SENDING", error: null, attempts: { increment: 1 } } })
    : await db.emailDelivery.create({ data: { ...base, idempotencyKey: input.idempotencyKey, channelMethod: "PENDING", status: "SENDING", attempts: 1 } });

  try {
    const r = await sendEmail(workspaceId, mail);
    delivery = await db.emailDelivery.update({ where: { id: delivery.id }, data: { status: "ACCEPTED", channelMethod: r.method, sender: r.sender, providerMessageId: r.messageId, sentAt: new Date() } });
  } catch (e) {
    const err = e instanceof EmailError ? e : new EmailError("Sending failed.", "OTHER");
    await db.emailDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error: err.message } });
    await logActivity({ workspaceId, prospectId: ctx.prospect.id, userId, type: "delivery.email_failed", message: `Email to ${to} failed: ${err.message}` });
    throw new SendError(err.message, err.code === "NOT_CONFIGURED" ? "Connect Gmail on the Integrations page." : err.code === "AUTH" ? "Update the App Password on the Integrations page." : undefined);
  }
  const followUps = await markSent(workspaceId, userId, input.proposalId, input.version, "email", input.scheduleFollowUps);
  if (followUps) await db.emailDelivery.update({ where: { id: delivery.id }, data: { followUpsScheduled: followUps } });
  await logActivity({
    workspaceId,
    prospectId: ctx.prospect.id,
    userId,
    type: ACTIVITY_TYPES.EMAIL_SENT,
    message: `Proposal v${input.version} emailed to ${to} (accepted by ${delivery.channelMethod === "GMAIL_API" ? "Gmail API" : delivery.channelMethod === "GMAIL_SMTP" ? "Gmail" : "SMTP server"})`,
    metadata: { deliveryId: delivery.id, messageId: delivery.providerMessageId },
  });
  return { delivery, duplicate: false, followUps };
}

export async function saveProposalEmailDraft(workspaceId: string, userId: string, input: EmailSendInput) {
  const { ctx, to, mail } = await prepareEmail(workspaceId, { ...input, confirmUnverified: true });
  try {
    const r = await saveDraft(workspaceId, mail);
    const delivery = await db.emailDelivery.create({
      data: { proposalId: input.proposalId, versionNumber: input.version, idempotencyKey: `${input.idempotencyKey}:draft:${Date.now()}`, channelMethod: r.method, sender: r.sender, recipient: to, subject: mail.subject, status: "DRAFT_SAVED", providerMessageId: r.draftId, templateId: input.templateId ?? null },
    });
    await logActivity({ workspaceId, prospectId: ctx.prospect.id, userId, type: "delivery.email_draft", message: `Email draft saved in ${r.sender} for ${to}` });
    return delivery;
  } catch (e) {
    throw new SendError(e instanceof EmailError ? e.message : "The draft could not be saved.");
  }
}

// ───────────────────────────── WhatsApp ─────────────────────────────

export type WhatsAppInput = { proposalId: string; version: number; to: string; message: string; idempotencyKey: string; scheduleFollowUps: boolean; confirmUnverified: boolean };

async function prepareWhatsApp(workspaceId: string, input: WhatsAppInput) {
  const ctx = await loadComposeContext(workspaceId, input.proposalId);
  if (!ctx) throw new SendError("Proposal not found.");
  if (input.version !== ctx.proposal.currentVersion) throw new SendError(`A newer version (v${ctx.proposal.currentVersion}) exists. Reload and send the latest version.`);
  checkContactable(ctx.prospect);
  const number = toWaNumber(input.to);
  if (!number) throw new SendError("The WhatsApp number must include the country code (e.g. +92 300 …).", "Edit the contact on the prospect page.");
  const known = ctx.contacts.find((c) => (c.type === "WHATSAPP" || c.type === "PHONE") && toWaNumber(c.value) === number);
  if ((!known || !known.verified) && !input.confirmUnverified) throw new SendError(known ? `+${number} has not been verified yet.` : `+${number} is not one of this prospect's saved numbers.`, "Verify it on the prospect page, or tick the confirmation box.");
  return { ctx, number };
}

/**
 * Click-to-chat for a proposal, the same wa.me link websites use for their WhatsApp button: the best
 * number found for the client (a WhatsApp link on their site first, then an international phone
 * number) and a ready message. WhatsApp links cannot carry files, so the PDF is attached by hand.
 */
export async function whatsAppDraft(workspaceId: string, proposalId: string) {
  const ctx = await loadComposeContext(workspaceId, proposalId);
  if (!ctx) return null;
  const numbers = ctx.contacts
    .filter((c) => (c.type === "WHATSAPP" || c.type === "PHONE") && toWaNumber(c.value))
    .sort((a, b) => (a.type === b.type ? 0 : a.type === "WHATSAPP" ? -1 : 1))
    // The same number often appears as a WhatsApp link and as a phone number: list it once.
    .filter((c, i, all) => all.findIndex((x) => toWaNumber(x.value) === toWaNumber(c.value)) === i)
    .map((c) => ({ value: c.value, onWhatsApp: c.type === "WHATSAPP" }));
  const v = ctx.vars;
  const intro = v.consultantName ? `This is ${v.consultantName}${v.companyName ? ` from ${v.companyName}` : ""}. ` : "";
  const message = [
    `Hi ${v.clientName ?? "there"},`,
    "",
    `${intro}I reviewed ${v.websiteUrl} and prepared an SEO proposal for ${v.businessName}.${v.auditSummary ? ` ${v.auditSummary}` : ""}`,
    "",
    "I'm sending you the full proposal as a PDF here. Happy to answer any questions.",
  ].join("\n");
  return { numbers, message, version: ctx.version.version, blocked: ctx.prospect.doNotContact, pdfUrl: `/api/proposals/${proposalId}/pdf?v=${ctx.version.version}&download=1` };
}

/** Records that a click-to-chat link was opened. Nothing is "sent" until the user confirms it. */
export async function openClickToChat(workspaceId: string, userId: string, input: WhatsAppInput) {
  const { ctx, number } = await prepareWhatsApp(workspaceId, input);
  if (UNRESOLVED.test(input.message)) throw new SendError("Some {{placeholders}} are still empty (create a share link for {{proposalLink}}).");
  const url = clickToChatUrl(`+${number}`, input.message)!;
  const existing = await db.whatsAppDelivery.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  const delivery =
    existing ??
    (await db.whatsAppDelivery.create({ data: { proposalId: input.proposalId, versionNumber: input.version, idempotencyKey: input.idempotencyKey, channelMethod: "CLICK_TO_CHAT", recipient: `+${number}`, messagePreview: input.message.slice(0, 500), status: "MANUAL_OPENED" } }));
  await logActivity({ workspaceId, prospectId: ctx.prospect.id, userId, type: "delivery.whatsapp_opened", message: `WhatsApp chat opened for +${number} (not yet confirmed as sent)` });
  return { url, delivery };
}

/** The user confirms they pressed Send in WhatsApp. */
export async function confirmClickToChatSent(workspaceId: string, userId: string, deliveryId: string, scheduleFollowUps: boolean) {
  const d = await db.whatsAppDelivery.findFirst({ where: { id: deliveryId, proposal: { workspaceId } }, include: { proposal: true } });
  if (!d) throw new SendError("Delivery not found.");
  if (d.status === "MANUAL_SENT") return { delivery: d, followUps: 0 };
  const delivery = await db.whatsAppDelivery.update({ where: { id: d.id }, data: { status: "MANUAL_SENT" } });
  const followUps = await markSent(workspaceId, userId, d.proposalId, d.versionNumber, "WhatsApp", scheduleFollowUps);
  await logActivity({ workspaceId, prospectId: d.proposal.prospectId, userId, type: ACTIVITY_TYPES.WHATSAPP_SENT, message: `Proposal v${d.versionNumber} sent on WhatsApp to ${d.recipient} (confirmed manually)` });
  return { delivery, followUps };
}

/** Sends an approved template through the official Cloud API. */
export async function sendWhatsAppCloud(workspaceId: string, userId: string, input: WhatsAppInput, fetchImpl?: typeof fetch) {
  const existing = await db.whatsAppDelivery.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && ["ACCEPTED", "SENT", "DELIVERED", "READ"].includes(existing.status)) return { delivery: existing, duplicate: true, followUps: 0 };
  const creds = await getCredentials<{ accessToken: string }>(workspaceId, "WHATSAPP_CLOUD");
  if (!creds) throw new SendError("The WhatsApp Business Platform is not connected.", "Set it up on the Integrations page, or use “Open in WhatsApp”.");
  const cfg = creds.config as unknown as CloudConfig;
  const { ctx, number } = await prepareWhatsApp(workspaceId, input);
  const bodyParams = (cfg.bodyParams ?? []).map((tpl) => renderTemplate(tpl, ctx.vars));
  const missing = [...new Set(bodyParams.flatMap((b) => b.missing))];
  if (missing.length) throw new SendError(`Template values are missing: ${missing.join(", ")}.`, missing.includes("proposalLink") ? "Create a share link on the proposal page." : "Fill them in under Settings.");
  const documentUrl = ctx.shareLink ? `${ctx.shareLink}/pdf` : null;
  const preview = bodyParams.map((b) => b.text).join(" | ");
  let delivery = existing
    ? await db.whatsAppDelivery.update({ where: { id: existing.id }, data: { status: "SENDING", error: null, attempts: { increment: 1 } } })
    : await db.whatsAppDelivery.create({ data: { proposalId: input.proposalId, versionNumber: input.version, idempotencyKey: input.idempotencyKey, channelMethod: "CLOUD_API", recipient: `+${number}`, messagePreview: preview.slice(0, 500), templateName: cfg.templateName, status: "SENDING", attempts: 1 } });
  try {
    const id = await sendTemplateMessage(creds.secret.accessToken, cfg, `+${number}`, { bodyParams: bodyParams.map((b) => b.text), documentUrl, documentFilename: `${ctx.prospect.businessName} SEO proposal.pdf` }, fetchImpl);
    delivery = await db.whatsAppDelivery.update({ where: { id: delivery.id }, data: { status: "ACCEPTED", providerMessageId: id } });
  } catch (e) {
    const err = e instanceof WhatsAppError ? e : new WhatsAppError("WhatsApp sending failed.", "OTHER", "Try again.");
    await db.whatsAppDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error: `${err.message} — ${err.recovery}` } });
    await logActivity({ workspaceId, prospectId: ctx.prospect.id, userId, type: "delivery.whatsapp_failed", message: `WhatsApp to +${number} failed: ${err.message}` });
    throw new SendError(err.message, err.recovery);
  }
  const followUps = await markSent(workspaceId, userId, input.proposalId, input.version, "WhatsApp", input.scheduleFollowUps);
  await logActivity({ workspaceId, prospectId: ctx.prospect.id, userId, type: ACTIVITY_TYPES.WHATSAPP_SENT, message: `WhatsApp template “${cfg.templateName}” accepted by WhatsApp for +${number}`, metadata: { deliveryId: delivery.id, messageId: delivery.providerMessageId } });
  return { delivery, duplicate: false, followUps };
}

const STATUS_RANK: Record<string, number> = { SENDING: 0, ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };

/** Applies webhook status updates. Statuses only move forward (a late "sent" never overwrites "read"). */
export async function applyWhatsAppStatuses(updates: StatusUpdate[]) {
  let applied = 0;
  for (const u of updates) {
    const d = await db.whatsAppDelivery.findFirst({ where: { providerMessageId: u.messageId }, include: { proposal: true } });
    if (!d) continue;
    if ((STATUS_RANK[u.status] ?? 0) <= (STATUS_RANK[d.status] ?? 0) && u.status !== "FAILED") continue;
    await db.whatsAppDelivery.update({ where: { id: d.id }, data: { status: u.status, error: u.error ?? d.error } });
    if (u.status === "FAILED" || u.status === "READ") {
      await logActivity({ workspaceId: d.proposal.workspaceId, prospectId: d.proposal.prospectId, type: u.status === "FAILED" ? "delivery.whatsapp_failed" : "delivery.whatsapp_read", message: u.status === "FAILED" ? `WhatsApp message to ${d.recipient} failed: ${u.error ?? "unknown reason"}` : `WhatsApp message read by ${d.recipient}` });
    }
    applied++;
  }
  return applied;
}
