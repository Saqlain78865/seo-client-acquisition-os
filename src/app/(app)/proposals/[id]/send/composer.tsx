"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Copy, Loader2, Paperclip, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { renderTemplate, type TemplateVars } from "@/lib/messaging/templates";
import { createShareAction, saveDraftAction, sendEmailAction } from "./actions";

type Template = { id: string; channel: string; name: string; subject: string | null; body: string };

const UNRESOLVED = /\{\{\s*\w+\s*\}\}/;
/** Template-select value for the prepared follow-up draft (not a saved template). */
const FOLLOW_UP = "__followup";

function MissingNotice({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <Alert tone="warning" title="Some placeholders are still empty">
      {missing.map((m) => `{{${m}}}`).join(", ")} — {missing.includes("proposalLink") ? "create a share link below, or " : ""}edit the text to remove them before sending.
    </Alert>
  );
}

/** Sends the proposal by email (Gmail), with the PDF attached. Nothing is sent until the user confirms. */
export function Composer(props: {
  proposalId: string;
  version: number;
  idempotencyKey: string;
  sender: { method: string; address: string } | null;
  vars: TemplateVars;
  shareLink: string | null;
  pdfName: string;
  emails: { value: string; verified: boolean; preferred: boolean }[];
  templates: Template[];
  blocked: boolean;
  /** Prepared follow-up draft, when the page was opened to follow up on a sent proposal. */
  followUp?: { subject: string; email: string } | null;
}) {
  const fu = props.followUp ?? null;
  const router = useRouter();
  const [pending, start] = useTransition();
  const emailTemplates = props.templates.filter((t) => t.channel === "EMAIL");

  const [emailTemplateId, setEmailTemplateId] = useState(fu ? FOLLOW_UP : (emailTemplates[0]?.id ?? ""));
  const firstEmail = props.emails.find((e) => e.preferred) ?? props.emails[0];
  const [to, setTo] = useState(firstEmail?.value ?? "");
  // CC sends a visible copy to someone else (e.g. the client's partner); BCC a hidden copy (e.g. yourself).
  const [showCopies, setShowCopies] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const tpl = emailTemplates.find((t) => t.id === emailTemplateId);
  const [subject, setSubject] = useState(() => (fu ? fu.subject : tpl ? renderTemplate(tpl.subject ?? "", props.vars).text : ""));
  const [body, setBody] = useState(() => (fu ? fu.email : tpl ? renderTemplate(tpl.body, props.vars).text : ""));
  // A follow-up is itself the reminder: no new reminders by default.
  const [followUps, setFollowUps] = useState(!fu);
  const [confirmUnverified, setConfirmUnverified] = useState(false);
  const knownEmail = props.emails.find((e) => e.value === to.trim().toLowerCase());
  const emailNeedsConfirm = !knownEmail || !knownEmail.verified;

  const emailMissing = useMemo(() => [...new Set([...subject.matchAll(/\{\{\s*(\w+)\s*\}\}/g), ...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))], [subject, body]);

  function applyEmailTemplate(id: string) {
    setEmailTemplateId(id);
    if (id === FOLLOW_UP && fu) {
      setSubject(fu.subject);
      setBody(fu.email);
      return;
    }
    const t = emailTemplates.find((x) => x.id === id);
    if (t) {
      setSubject(renderTemplate(t.subject ?? "", props.vars).text);
      setBody(renderTemplate(t.body, props.vars).text);
    }
  }

  const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const emailInput = () => ({
    proposalId: props.proposalId,
    version: props.version,
    to: to.trim(),
    cc: split(cc),
    bcc: split(bcc),
    subject,
    body,
    templateId: emailTemplateId && emailTemplateId !== FOLLOW_UP ? emailTemplateId : null,
    idempotencyKey: props.idempotencyKey,
    scheduleFollowUps: followUps,
    confirmUnverified,
  });

  function sendEmail() {
    if (!confirm(`Send version ${props.version} to ${to}${cc ? ` (cc ${cc})` : ""} from ${props.sender?.address}?\n\nSubject: ${subject}\nAttachment: ${props.pdfName}`)) return;
    start(async () => {
      const r = await sendEmailAction(emailInput());
      if (!r.ok) return void toast.error(r.recovery ? `${r.error} ${r.recovery}` : r.error);
      toast.success(r.duplicate ? "This email was already sent — no duplicate was sent." : `Email accepted by ${r.sender} for delivery${r.followUps ? ` · ${r.followUps} follow-up reminders scheduled` : ""}`);
      router.push(`/proposals/${props.proposalId}`);
      router.refresh();
    });
  }

  function createLink(days: number) {
    start(async () => {
      const r = await createShareAction(props.proposalId, days);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Share link created");
      router.refresh();
    });
  }

  return (
    <div>
      {fu && (
        <Alert tone="info" title="Your follow-up draft is ready" className="mb-4">
          Written for this client from the proposal. Read it once, change anything you like, then send. The proposal PDF is attached again, and nothing is sent until you click Send.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Email"
          description={props.sender ? `From ${props.sender.address} (${props.sender.method === "GMAIL_API" ? "Gmail API" : props.sender.method === "GMAIL_SMTP" ? "Gmail" : "SMTP"})` : "No email account connected"}
        />
        {!props.sender ? (
          <div className="space-y-3 p-5 text-sm">
            <Alert tone="warning" title="Connect an email account to send from here">
              Add your Gmail App Password on the Integrations page. Until then you can download the PDF and send it from your own email app.
            </Alert>
            {fu && (
              <div className="space-y-2 rounded-xl border border-border bg-surface-2/50 p-4">
                <p className="font-medium">Your follow-up email (copy it into your email app)</p>
                <Input aria-label="Follow-up subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Textarea aria-label="Follow-up message" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(
                      () => toast.success("Follow-up copied"),
                      () => toast.error("Copy failed — select the text manually"),
                    )
                  }
                >
                  <Copy className="h-4 w-4" /> Copy email
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Link href="/integrations" className={buttonClass("primary")}>
                Connect Gmail
              </Link>
              <a href={`/api/proposals/${props.proposalId}/pdf?v=${props.version}&download=1`} className={buttonClass("secondary")}>
                Download PDF
              </a>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="To" name="to" hint={knownEmail ? (knownEmail.verified ? "Verified contact" : "Saved but not verified") : "Not a saved contact"}>
              <Input type="email" list="known-emails" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <datalist id="known-emails">
              {props.emails.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.verified ? "verified" : "unverified"}
                </option>
              ))}
            </datalist>
            <Field label="Template" name="emailTemplate">
              <Select value={emailTemplateId} onChange={(e) => applyEmailTemplate(e.target.value)}>
                {fu && <option value={FOLLOW_UP}>Follow-up draft (prepared for you)</option>}
                {emailTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            {showCopies ? (
              <>
                <Field label="CC" name="cc" hint="Also sent to — everyone sees it. Separate several with commas.">
                  <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="partner@client.com" />
                </Field>
                <Field label="BCC" name="bcc" hint="Hidden copy, e.g. your own address for your records.">
                  <Input value={bcc} onChange={(e) => setBcc(e.target.value)} />
                </Field>
              </>
            ) : (
              <button type="button" onClick={() => setShowCopies(true)} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline sm:col-span-2">
                <Plus className="h-3.5 w-3.5" /> CC / BCC (send a copy to someone else)
              </button>
            )}
            <Field label="Subject" name="subject" className="sm:col-span-2">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" name="body" className="sm:col-span-2">
              <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <MissingNotice missing={emailMissing} />
            </div>
            {emailMissing.includes("proposalLink") && (
              <div className="rounded-lg border border-border p-3 text-sm sm:col-span-2">
                <p className="font-medium">Secure proposal link</p>
                {props.shareLink ? (
                  <p className="mt-1 break-all text-muted">{props.shareLink}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-muted">No active link for this version.</span>
                    {[7, 14, 30].map((d) => (
                      <Button key={d} size="sm" variant="secondary" disabled={pending || props.blocked} onClick={() => createLink(d)}>
                        Create ({d} days)
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="flex items-center gap-2 text-sm sm:col-span-2">
              <Paperclip className="h-4 w-4 text-muted" /> Attachment: proposal PDF, version {props.version}
            </p>
            <div className="space-y-2 text-sm sm:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} className="h-4 w-4" /> Schedule follow-up reminders (reminders only — nothing is sent automatically)
              </label>
              {emailNeedsConfirm && (
                <label className="flex items-center gap-2 text-warning">
                  <input type="checkbox" checked={confirmUnverified} onChange={(e) => setConfirmUnverified(e.target.checked)} className="h-4 w-4" /> I confirm this address is correct and that I may contact it
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button disabled={pending || props.blocked || !to || UNRESOLVED.test(subject + body) || (emailNeedsConfirm && !confirmUnverified)} onClick={sendEmail}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send email
              </Button>
              {props.sender.method !== "SMTP" && (
                <Button
                  variant="secondary"
                  disabled={pending || props.blocked || !to}
                  onClick={() =>
                    start(async () => {
                      const r = await saveDraftAction(emailInput());
                      if (r.ok) toast.success(`Draft saved in ${r.sender}'s Gmail Drafts — nothing was sent`);
                      else toast.error(r.error);
                    })
                  }
                >
                  Save as Gmail draft
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
