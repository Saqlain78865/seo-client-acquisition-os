import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import { getCredentials } from "../integrations";
import { gmailCreateDraft, gmailSend } from "./google-oauth";

export type OutgoingEmail = {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  /** Optional HTML version; the plain text is always sent too. */
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

export type EmailMethod = "GMAIL_API" | "GMAIL_SMTP" | "SMTP";

export class EmailError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "AUTH" | "REJECTED" | "NETWORK" | "RATE_LIMITED" | "OTHER",
  ) {
    super(message);
  }
}

type SmtpSecret = { user: string; pass: string };
type SmtpConfig = { host?: string; port?: number; secure?: boolean; fromName?: string; fromEmail?: string };

/** Picks the connected sending account: Gmail API first, then Gmail App Password, then custom SMTP. */
export async function resolveSender(workspaceId: string) {
  const oauth = await getCredentials<{ refreshToken: string }>(workspaceId, "GMAIL_OAUTH");
  if (oauth && oauth.status === "CONNECTED") return { method: "GMAIL_API" as const, from: oauth.accountLabel ?? "", oauth, fromName: (oauth.config.fromName as string) ?? "" };
  const gmail = await getCredentials<SmtpSecret>(workspaceId, "GMAIL_SMTP");
  if (gmail && gmail.status !== "ERROR") return { method: "GMAIL_SMTP" as const, from: gmail.secret.user, smtp: { host: "smtp.gmail.com", port: 465, secure: true, ...gmail.secret }, fromName: (gmail.config.fromName as string) ?? "" };
  const smtp = await getCredentials<SmtpSecret>(workspaceId, "SMTP");
  if (smtp && smtp.status !== "ERROR") {
    const c = smtp.config as SmtpConfig;
    return { method: "SMTP" as const, from: c.fromEmail || smtp.secret.user, smtp: { host: c.host!, port: c.port ?? 587, secure: c.secure ?? false, ...smtp.secret }, fromName: c.fromName ?? "" };
  }
  return null;
}

function transport(s: { host: string; port: number; secure: boolean; user: string; pass: string }) {
  const local = /^(127\.|localhost$)/.test(s.host);
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
    // Only a local test/relay server may skip TLS.
    ...(local ? { ignoreTLS: true, tls: { rejectUnauthorized: false } } : { requireTLS: !s.secure }),
  });
}

function mapSmtpError(e: unknown): EmailError {
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.code === "EAUTH" || err.responseCode === 535) return new EmailError("The email account rejected the login. For Gmail, use a 16-character App Password (not your normal password) and check 2-Step Verification is on.", "AUTH");
  if (err.responseCode === 550 || err.responseCode === 553) return new EmailError(`The recipient was rejected: ${err.message?.slice(0, 200)}`, "REJECTED");
  if (err.responseCode === 421 || err.responseCode === 454 || /rate|limit|too many/i.test(err.message ?? "")) return new EmailError("The email provider is limiting sending right now. Try again later.", "RATE_LIMITED");
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(err.code ?? "")) return new EmailError("Could not reach the email server. Check your internet connection.", "NETWORK");
  return new EmailError(`Sending failed: ${err.message?.slice(0, 300) ?? "unknown error"}`, "OTHER");
}

function fromHeader(name: string, email: string) {
  return name ? { name, address: email } : email;
}

async function buildMime(from: string, fromName: string, mail: OutgoingEmail) {
  return new MailComposer({ from: fromHeader(fromName, from), to: mail.to, cc: mail.cc, bcc: mail.bcc, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments }).compile().build();
}

/** Sends through the connected account. The returned id is the provider's message id (accepted for delivery, not read). */
export async function sendEmail(workspaceId: string, mail: OutgoingEmail): Promise<{ method: EmailMethod; sender: string; messageId: string }> {
  const s = await resolveSender(workspaceId);
  if (!s) throw new EmailError("No email account is connected. Connect Gmail on the Integrations page.", "NOT_CONFIGURED");
  if (s.method === "GMAIL_API") {
    const raw = await buildMime(s.from, s.fromName, mail);
    return { method: s.method, sender: s.from, messageId: await gmailSend(s.oauth.secret.refreshToken, raw) };
  }
  try {
    const info = await transport(s.smtp).sendMail({ from: fromHeader(s.fromName, s.from), to: mail.to, cc: mail.cc, bcc: mail.bcc, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
    if (info.rejected?.length) throw Object.assign(new Error(`Rejected: ${info.rejected.join(", ")}`), { responseCode: 550 });
    return { method: s.method, sender: s.from, messageId: info.messageId };
  } catch (e) {
    throw mapSmtpError(e);
  }
}

/** Saves the message as a draft in the user's mailbox (Gmail API, or IMAP for Gmail App Password). */
export async function saveDraft(workspaceId: string, mail: OutgoingEmail): Promise<{ method: EmailMethod; sender: string; draftId: string }> {
  const s = await resolveSender(workspaceId);
  if (!s) throw new EmailError("No email account is connected.", "NOT_CONFIGURED");
  const raw = await buildMime(s.from, s.fromName, mail);
  if (s.method === "GMAIL_API") return { method: s.method, sender: s.from, draftId: await gmailCreateDraft(s.oauth.secret.refreshToken, raw) };
  if (s.method !== "GMAIL_SMTP") throw new EmailError("Drafts are available for Gmail accounts only.", "OTHER");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: s.smtp.user, pass: s.smtp.pass }, logger: false });
  try {
    await client.connect();
    const boxes = await client.list();
    const drafts = boxes.find((b) => b.specialUse === "\\Drafts")?.path ?? "[Gmail]/Drafts";
    const res = await client.append(drafts, raw, ["\\Draft", "\\Seen"]);
    return { method: s.method, sender: s.from, draftId: String((res && typeof res === "object" && "uid" in res ? res.uid : "") || "saved") };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/auth|credentials|login/i.test(msg)) throw new EmailError("Gmail rejected the login for drafts (IMAP). Check the App Password and that IMAP is enabled in Gmail settings.", "AUTH");
    throw new EmailError(`Could not save the draft: ${msg.slice(0, 200)}`, "OTHER");
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Verifies the SMTP login without sending anything. */
export async function verifySmtp(s: { host: string; port: number; secure: boolean; user: string; pass: string }) {
  try {
    await transport(s).verify();
  } catch (e) {
    throw mapSmtpError(e);
  }
}
