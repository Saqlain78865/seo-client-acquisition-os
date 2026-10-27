import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { resolveSender } from "@/lib/messaging/email";
import { loadComposeContext, whatsAppDraft } from "@/lib/messaging/service";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { WhatsAppButton, WhatsAppIcon } from "@/components/whatsapp-button";
import { Composer } from "./composer";

export const metadata: Metadata = { title: "Send proposal" };

export default async function SendPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ followup?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const ctx = await loadComposeContext(session.workspace.id, id);
  if (!ctx) notFound();
  const [sender, wa] = await Promise.all([resolveSender(session.workspace.id), whatsAppDraft(session.workspace.id, id)]);
  const pdfName = `SEO-Proposal-…-v${ctx.version.version}.pdf`;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/proposals/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to proposal
      </Link>
      <PageHeader
        title={sp.followup ? "Follow up on the proposal" : "Send proposal"}
        description={`${ctx.prospect.businessName} · version ${ctx.version.version}. Nothing is sent until you confirm.`}
      />
      {ctx.prospect.doNotContact && (
        <Alert tone="danger" title="This prospect has opted out" className="mb-4">
          {ctx.prospect.doNotContactReason ?? "They asked not to be contacted."} Sending is blocked until the opt-out is removed on the prospect page.
        </Alert>
      )}
      <Composer
        proposalId={id}
        version={ctx.version.version}
        // A fresh key per page load: double clicks and retries from this screen can never send twice.
        idempotencyKey={randomToken(18)}
        sender={sender ? { method: sender.method, address: sender.from } : null}
        vars={ctx.vars}
        shareLink={ctx.shareLink}
        pdfName={pdfName}
        emails={ctx.contacts.filter((c) => c.type === "EMAIL").map((c) => ({ value: c.value, verified: c.verified, preferred: c.isPreferred }))}
        templates={ctx.templates.map((t) => ({ id: t.id, channel: t.channel, name: t.name, subject: t.subject, body: t.body }))}
        blocked={ctx.prospect.doNotContact}
        followUp={sp.followup ? ctx.followUp : null}
      />
      <Card className="mt-6">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <WhatsAppIcon className="text-[#25D366]" /> Or send on WhatsApp
            </span>
          }
          description="Opens the client's chat with a ready message and downloads the PDF — drop the PDF into the chat and press Send. Free click-to-chat, no WhatsApp API."
        />
        {wa && wa.numbers.length > 0 ? (
          <ul className="divide-y divide-border">
            {wa.numbers.map((n) => (
              <li key={n.value} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-medium tabular-nums">{n.value}</span>
                <span className={n.whatsapp === "CONFIRMED" ? "text-xs font-medium text-[#128C7E]" : n.whatsapp === "LIKELY" ? "text-xs text-text" : "text-xs text-warning"}>{n.label}</span>
                <span className="ml-auto">
                  <WhatsAppButton proposalId={id} number={n.value} label="Send on WhatsApp" disabled={wa.blocked} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-muted">No number that could be on WhatsApp was found on this website (landlines and invalid numbers are left out). Add one with the country code, e.g. +971…, on the prospect page.</p>
        )}
      </Card>
    </div>
  );
}
