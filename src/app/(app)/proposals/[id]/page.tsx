import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Copy, Download, Lock, MessageCircleQuestion, Pencil, Send } from "lucide-react";
import { db } from "@/lib/db";
import { qrDataUri, shareState, shareUrl } from "@/lib/messaging/share";
import { requireSession } from "@/lib/auth";
import { getProposalWithVersion } from "@/lib/proposals/service";
import { formatDate, timeAgo } from "@/lib/utils";
import { Alert, Badge, Card, CardHeader, PageHeader, buttonClass } from "@/components/ui";
import { ProposalStatusBadge } from "../status";
import { duplicateProposalAction } from "../actions";
import { PdfButton, ReadyToggle, TranslateButtons } from "./client-bits";
import { ShareCard } from "./share-card";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { whatsAppDraft } from "@/lib/messaging/service";
import { ReadingCard } from "./reading-card";
import { WhatsAppStatusCard } from "./whatsapp-card";
import { whatsAppFollowUp, whatsAppState } from "@/lib/messaging/manual";

export const metadata: Metadata = { title: "Proposal" };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const found = await getProposalWithVersion(session.workspace.id, id, sp.v ? Number(sp.v) : undefined);
  if (!found) notFound();
  const { proposal, version } = found;
  const pdf = version.attachments.find((a) => a.kind === "PDF");
  const isLatest = version.version === proposal.currentVersion;
  const share = shareState(proposal);
  const link = share === "ACTIVE" && proposal.shareToken ? shareUrl(proposal.shareToken) : null;
  const [emails, whatsapps, qr, responses, wa, waState] = await Promise.all([
    db.emailDelivery.findMany({ where: { proposalId: proposal.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.whatsAppDelivery.findMany({ where: { proposalId: proposal.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    link ? qrDataUri(link) : null,
    db.proposalResponse.findMany({ where: { proposalId: proposal.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    whatsAppDraft(session.workspace.id, proposal.id),
    whatsAppState(proposal.id),
  ]);
  const waFollowUp = waState.seen ? await whatsAppFollowUp(session.workspace.id, proposal.id) : null;
  const deliveries = [
    ...emails.map((d) => ({ id: d.id, at: d.sentAt ?? d.createdAt, channel: "Email", to: d.recipient, status: d.status, version: d.versionNumber, detail: d.error ?? (d.sender ? `from ${d.sender}` : null), messageId: d.providerMessageId })),
    ...whatsapps.map((d) => ({ id: d.id, at: d.updatedAt, channel: d.channelMethod === "CLOUD_API" ? "WhatsApp API" : "WhatsApp (manual)", to: d.recipient, status: d.status, version: d.versionNumber, detail: d.error, messageId: d.providerMessageId })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <PageHeader
        title={version.title ?? proposal.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={proposal.status} />
            <Badge>v{version.version}</Badge>
            {version.locked && (
              <Badge tone="info">
                <Lock className="h-3 w-3" /> Sent version — read only
              </Badge>
            )}
            <Link href={`/prospects/${proposal.prospect.id}`} className="hover:text-primary">
              {proposal.prospect.businessName}
            </Link>
          </span>
        }
        actions={
          <>
            <form action={duplicateProposalAction.bind(null, proposal.id)}>
              <button type="submit" className={buttonClass("secondary")}>
                <Copy className="h-4 w-4" /> Duplicate
              </button>
            </form>
            {isLatest && (
              <Link href={`/proposals/${proposal.id}/send`} className={buttonClass("primary")}>
                <Send className="h-4 w-4" /> Send
              </Link>
            )}
            {isLatest && wa && wa.numbers[0] && !wa.blocked && <WhatsAppButton proposalId={proposal.id} number={wa.numbers[0].value} />}
            <Link href={`/proposals/${proposal.id}/edit?v=${version.version}`} className={buttonClass("secondary")}>
              <Pencil className="h-4 w-4" /> {version.locked ? "Edit as new version" : "Edit"}
            </Link>
          </>
        }
      />

      {proposal.acceptedAt && (
        <Alert tone="success" title={`Accepted online ${timeAgo(proposal.acceptedAt)}`} className="mb-4">
          The client accepted this proposal on the share link. Confirm the agreement with them, then record the deal as won on the prospect page.
        </Alert>
      )}

      {!isLatest && (
        <Alert tone="info" className="mb-4">
          You are viewing v{version.version}. The latest is{" "}
          <Link className="font-medium underline" href={`/proposals/${proposal.id}`}>
            v{proposal.currentVersion}
          </Link>
          .
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardHeader title="Preview" description="Exactly what the PDF will contain." action={<a href={`/api/proposals/${proposal.id}/html?v=${version.version}`} target="_blank" className="text-xs text-primary hover:underline">Open full screen</a>} />
          <iframe
            title="Proposal preview"
            src={`/api/proposals/${proposal.id}/html?v=${version.version}`}
            sandbox=""
            className="h-[75vh] w-full bg-[#e9edf3]"
          />
        </Card>

        <div className="space-y-6">
          {isLatest && !wa?.blocked && (
            <WhatsAppStatusCard proposalId={proposal.id} state={{ ...waState, sentAt: waState.sentAt?.toISOString() ?? null }} followUp={waFollowUp} />
          )}
          <Card>
            <CardHeader title="PDF" />
            <div className="space-y-3 p-5 text-sm">
              {pdf ? (
                <p className="text-muted">
                  Generated {formatDate(pdf.createdAt, true)} · {(pdf.bytes / 1024).toFixed(0)} KB
                </p>
              ) : (
                <p className="text-muted">Not generated yet for this version.</p>
              )}
              <PdfButton proposalId={proposal.id} version={version.version} hasPdf={!!pdf} />
              {pdf && (
                <div className="flex gap-2">
                  <a href={`/api/proposals/${proposal.id}/pdf?v=${version.version}`} target="_blank" className={buttonClass("secondary", "sm")}>
                    View PDF
                  </a>
                  <a href={`/api/proposals/${proposal.id}/pdf?v=${version.version}&download=1`} className={buttonClass("secondary", "sm")}>
                    <Download className="h-4 w-4" /> Download
                  </a>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Summary" />
            <dl className="space-y-2 p-5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Proposal date</dt>
                <dd>{formatDate(version.proposalDate)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Valid until</dt>
                <dd>{formatDate(version.validUntil)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Services included</dt>
                <dd>{((version.services as string[] | null) ?? []).length}</dd>
              </div>
            </dl>
            {isLatest && (proposal.status === "DRAFT" || proposal.status === "READY") && (
              <div className="border-t border-border p-5">
                <ReadyToggle proposalId={proposal.id} ready={proposal.status === "READY"} />
              </div>
            )}
            {isLatest && (
              <div className="border-t border-border p-5">
                <TranslateButtons proposalId={proposal.id} />
              </div>
            )}
          </Card>

          {responses.length > 0 && (
            <Card className="border-success/40">
              <CardHeader title="Client responses" description="Sent from the share link" />
              <ul className="divide-y divide-border text-sm">
                {responses.map((r) => (
                  <li key={r.id} className="space-y-1 px-5 py-3">
                    <div className="flex items-center gap-2">
                      {r.kind === "ACCEPT" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <MessageCircleQuestion className="h-4 w-4 text-primary" />}
                      <span className="font-medium">{r.kind === "ACCEPT" ? "Accepted" : "Question"}</span>
                      <span className="ml-auto text-xs text-muted">{timeAgo(r.createdAt)}</span>
                    </div>
                    <p className="text-muted">
                      {r.name}
                      {r.contact ? ` · ${r.contact}` : ""} · v{r.version}
                    </p>
                    {r.message && <p className="rounded-lg bg-surface-2 px-3 py-2 whitespace-pre-wrap">{r.message}</p>}
                    {r.signature && (
                      <figure className="rounded-lg border border-border bg-white p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.signature} alt={`Signature of ${r.name}`} className="h-14 w-auto" />
                        <figcaption className="text-[11px] text-muted">Signed online · {formatDate(r.createdAt, true)}</figcaption>
                      </figure>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ReadingCard workspaceId={session.workspace.id} proposalId={proposal.id} shared={!!proposal.shareToken} />

          <Card>
            <CardHeader title="Share link" />
            <ShareCard
              proposalId={proposal.id}
              state={share}
              url={link}
              qr={qr}
              expiresAt={proposal.shareExpiresAt?.toISOString() ?? null}
              views={proposal.shareViews}
              lastViewedAt={proposal.shareLastViewedAt?.toISOString() ?? null}
              sharedVersion={proposal.shareVersion}
            />
          </Card>

          <Card>
            <CardHeader title="Deliveries" description="“Accepted” means the provider took the message — not that it was read." />
            {deliveries.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">Not sent yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {deliveries.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{d.channel}</span>
                      <Badge tone={d.status === "FAILED" ? "danger" : ["ACCEPTED", "SENT", "DELIVERED", "READ", "MANUAL_SENT"].includes(d.status) ? "success" : "neutral"}>
                        {d.status.replace("_", " ").toLowerCase()}
                      </Badge>
                    </div>
                    <p className="break-all text-xs text-muted">
                      to {d.to} · v{d.version} · {formatDate(d.at, true)}
                    </p>
                    {d.detail && <p className={d.status === "FAILED" ? "text-xs text-danger" : "text-xs text-muted"}>{d.detail}</p>}
                    {d.messageId && <p className="truncate text-[11px] text-muted" title={d.messageId}>id {d.messageId}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Version history" description="Sent versions are kept unchanged." />
            <ul className="divide-y divide-border text-sm">
              {proposal.versions.map((v) => (
                <li key={v.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <Link href={`/proposals/${proposal.id}?v=${v.version}`} className={v.version === version.version ? "font-semibold text-primary" : "font-medium hover:text-primary"}>
                      Version {v.version}
                    </Link>
                    <span className="flex gap-1">
                      {v.locked && <Badge tone="info">sent</Badge>}
                      {v.attachments.length > 0 && <Badge>PDF</Badge>}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {formatDate(v.createdAt, true)}
                    {v.createdBy?.name ? ` · ${v.createdBy.name}` : ""}
                  </p>
                  {v.changeNote && <p className="text-xs text-muted">{v.changeNote}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
