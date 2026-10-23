import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { resolveSender } from "@/lib/messaging/email";
import { loadComposeContext } from "@/lib/messaging/service";
import { Alert, PageHeader } from "@/components/ui";
import { Composer } from "./composer";

export const metadata: Metadata = { title: "Send proposal" };

export default async function SendPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ followup?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const ctx = await loadComposeContext(session.workspace.id, id);
  if (!ctx) notFound();
  const sender = await resolveSender(session.workspace.id);
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
    </div>
  );
}
