import "server-only";
import { db } from "../db";
import { createProposal } from "../proposals/service";
import { resolveSender } from "./email";
import { SendError, loadComposeContext, sendProposalEmail } from "./service";
import { renderTemplate } from "./templates";
import { countryCode, countryFromDomain, whatsAppNumbers } from "../phone";
import { DEFAULT_TEMPLATES } from "../workspace";

export type BatchSendRow = {
  proposalId: string;
  version: number;
  businessName: string;
  domain: string;
  to: string | null;
  verified: boolean;
  subject: string;
  /** Best number for WhatsApp click-to-chat (a WhatsApp link on the site first), when one was found. */
  whatsapp: string | null;
  /** Why this proposal cannot be sent now (no email, already sent, empty placeholder…), or null when ready. */
  problem: string | null;
  sent: boolean;
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The email that would go to one proposal's client: default email template, preferred address. */
async function draftFor(workspaceId: string, proposalId: string) {
  const ctx = await loadComposeContext(workspaceId, proposalId);
  if (!ctx) return null;
  // A workspace without email templates uses the built-in first-send email.
  const template = ctx.templates.find((t) => t.channel === "EMAIL" && t.isDefault) ?? ctx.templates.find((t) => t.channel === "EMAIL") ?? { id: null, ...DEFAULT_TEMPLATES[0] };
  const contact = ctx.contacts.find((c) => c.type === "EMAIL");
  const whatsapp = whatsAppNumbers(ctx.contacts, countryCode(ctx.prospect.country) ?? countryFromDomain(ctx.prospect.domain))[0]?.value ?? null;
  // With no findings there is no summary sentence: drop that line rather than block the email.
  const optional = (t: string) => (ctx.vars.auditSummary ? t : t.replace(/\n?[ \t]*\{\{\s*auditSummary\s*\}\}[ \t]*\n?/g, "\n"));
  const subject = renderTemplate(optional(template.subject ?? ""), ctx.vars);
  const body = renderTemplate(optional(template.body), ctx.vars);
  const sent = !!(await db.emailDelivery.findFirst({ where: { proposalId, versionNumber: ctx.version.version, status: "ACCEPTED" }, select: { id: true } }));
  const missing = [...new Set([...subject.missing, ...body.missing])];
  let problem: string | null = null;
  if (sent) problem = "Already sent";
  else if (ctx.prospect.doNotContact) problem = "Opted out of contact";
  else if (!contact) problem = "No email address found on the website";
  else if (missing.length) problem = `Empty placeholder ${missing.map((m) => `{{${m}}}`).join(", ")}${missing.includes("consultantName") ? " — add your name in Settings" : ""}`;
  return { ctx, template, contact, whatsapp, subject: subject.text, body: body.text, sent, problem };
}

/** Every proposal of a bulk audit, with who it would go to and whether it can be sent. */
export async function batchSendPreview(workspaceId: string, batchId: string): Promise<BatchSendRow[]> {
  const proposals = await db.proposal.findMany({
    where: { workspaceId, audit: { batchId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, prospect: { select: { businessName: true, domain: true } } },
  });
  const rows: BatchSendRow[] = [];
  for (const p of proposals) {
    const d = await draftFor(workspaceId, p.id);
    if (!d) continue;
    rows.push({
      proposalId: p.id,
      version: d.ctx.version.version,
      businessName: p.prospect.businessName,
      domain: p.prospect.domain,
      to: d.contact?.value ?? null,
      verified: !!d.contact?.verified,
      whatsapp: d.whatsapp,
      subject: d.subject,
      problem: d.problem,
      sent: d.sent,
    });
  }
  return rows;
}

/** Drafts a proposal for every finished audit in the batch that does not have one yet. */
export async function createBatchProposals(workspaceId: string, userId: string, batchId: string) {
  const audits = await db.websiteAudit.findMany({
    where: { workspaceId, batchId, status: { in: ["COMPLETED", "PARTIAL"] }, proposals: { none: {} } },
    select: { id: true, prospectId: true },
  });
  for (const a of audits) await createProposal(workspaceId, userId, { prospectId: a.prospectId, auditId: a.id });
  return audits.length;
}

/**
 * Sends the chosen proposals one after another, each with its PDF, from the connected Gmail.
 * The person confirmed the list (including unverified addresses found on the websites) before
 * this runs. A proposal is never sent twice: the key is fixed per proposal version.
 */
/**
 * Emails one proposal to its client with the default template and the PDF. Used by the bulk send
 * and by auto-send campaigns; the fixed key means a proposal version is never emailed twice.
 */
export async function sendOneProposal(workspaceId: string, userId: string, proposalId: string): Promise<{ proposalId: string; ok: boolean; message: string; to?: string }> {
  const d = await draftFor(workspaceId, proposalId);
  if (!d || d.problem || !d.contact) return { proposalId, ok: false, message: d?.problem ?? "Proposal not found" };
  try {
    const r = await sendProposalEmail(workspaceId, userId, {
      proposalId,
      version: d.ctx.version.version,
      to: d.contact.value,
      cc: [],
      bcc: [],
      subject: d.subject,
      body: d.body,
      templateId: d.template.id,
      idempotencyKey: `bulk:${proposalId}:v${d.ctx.version.version}`,
      scheduleFollowUps: true,
      confirmUnverified: true,
    });
    return { proposalId, ok: true, message: r.duplicate ? "Already sent" : `Sent to ${d.contact.value}`, to: d.contact.value };
  } catch (e) {
    return { proposalId, ok: false, message: e instanceof SendError ? e.message : "Sending failed" };
  }
}

export async function sendBatchProposals(workspaceId: string, userId: string, batchId: string, proposalIds: string[]) {
  if (!(await resolveSender(workspaceId))) throw new SendError("Connect Gmail on the Integrations page first.");
  const allowed = new Set((await db.proposal.findMany({ where: { workspaceId, audit: { batchId }, id: { in: proposalIds } }, select: { id: true } })).map((p) => p.id));
  const results: { proposalId: string; ok: boolean; message: string }[] = [];
  for (const proposalId of proposalIds) {
    if (!allowed.has(proposalId)) continue;
    const r = await sendOneProposal(workspaceId, userId, proposalId);
    results.push({ proposalId: r.proposalId, ok: r.ok, message: r.message });
    // A short pause keeps Gmail from treating the run as a burst.
    if (r.to) await pause(1200);
  }
  return results;
}
