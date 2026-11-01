import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, ExternalLink, FileSearch, FileText, Pencil, ScanSearch, Star, Telescope } from "lucide-react";
import { hasRole, requireSession } from "@/lib/auth";
import { getProspect } from "@/lib/prospects";
import { getPipelineStatuses } from "@/lib/workspace";
import { db } from "@/lib/db";
import { FOLLOW_UP_TYPES, type FollowUpType } from "@/lib/constants";
import { formatDate, formatMoney, timeAgo } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { StatusChanger } from "./status-changer";
import { ContactsPanel } from "./contacts-panel";
import { FollowUpForm, FollowUpRow } from "./follow-ups";
import { NoteForm } from "./note-form";
import { DangerZone } from "./danger-zone";
import { OptOut } from "./opt-out";
import { KickoffChecklist } from "./kickoff";
import { TrackingCard } from "./tracking-card";
import { totals } from "@/lib/search-console";
import { CHANGE_LABELS, type ChangeKind } from "@/lib/site-changes";
import { createProposalAction } from "../../proposals/actions";

export const metadata: Metadata = { title: "Prospect" };

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const [p, statuses] = await Promise.all([getProspect(session.workspace.id, id), getPipelineStatuses(session.workspace.id)]);
  if (!p) notFound();
  const statusLabel = new Map(statuses.map((s) => [s.key, s.label]));
  const isAdmin = hasRole(session, "ADMIN");
  const mergeCandidates = isAdmin
    ? await db.prospect.findMany({
        where: { workspaceId: session.workspace.id, id: { not: p.id } },
        select: { id: true, businessName: true, domain: true },
        orderBy: { businessName: "asc" },
        take: 500,
      })
    : [];
  const likelyDuplicates = mergeCandidates.filter((c) => c.domain === p.domain);
  const latestAudit = p.audits.find((a) => a.status === "COMPLETED" || a.status === "PARTIAL");
  const kickoff = await db.kickoffTask.findMany({ where: { prospectId: p.id, workspaceId: session.workspace.id }, orderBy: { sortOrder: "asc" } });
  // Search Console totals (last 28 synced days against the 28 before) and the latest website changes.
  const [gscConn, track, gscDays, changes] = await Promise.all([
    db.integrationConnection.findFirst({ where: { workspaceId: session.workspace.id, provider: "SEARCH_CONSOLE", status: "CONNECTED", encryptedSecret: { not: null } }, select: { id: true } }),
    db.prospect.findUniqueOrThrow({ where: { id: p.id }, select: { gscSiteUrl: true, gscSyncedAt: true, changesCheckedAt: true } }),
    db.gscDaily.findMany({ where: { prospectId: p.id }, orderBy: { date: "desc" }, take: 56 }),
    db.siteChange.findMany({ where: { prospectId: p.id, workspaceId: session.workspace.id }, orderBy: { detectedAt: "desc" }, take: 30 }),
  ]);
  const last28 = gscDays.slice(0, 28);
  const prev28 = gscDays.slice(28, 56);

  return (
    <>
      <PageHeader
        title={p.businessName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-primary">
              {p.domain} <ExternalLink className="h-3 w-3" />
            </a>
            <StatusBadge status={p.status} label={statusLabel.get(p.status)} />
            {likelyDuplicates.length > 0 && <Badge tone="warning">Possible duplicate</Badge>}
          </span>
        }
        actions={
          <>
            <Link href={`/prospects/${p.id}/edit`} className={buttonClass("secondary")}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
            <Link href={`/prospects/${p.id}/research`} className={buttonClass("secondary")}>
              <Telescope className="h-4 w-4" /> Research
            </Link>
            {p.status === "WON" && (
              <Link href={`/review-kit?client=${p.id}`} className={buttonClass("secondary")}>
                <Star className="h-4 w-4" /> Review kit
              </Link>
            )}
            <Link href={`/audits/new?prospectId=${p.id}`} className={buttonClass("primary")}>
              <ScanSearch className="h-4 w-4" /> Run audit
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Overview" />
            <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-3">
              {[
                ["Industry", p.industry],
                ["Location", [p.city, p.country].filter(Boolean).join(", ")],
                ["Services", p.primaryServices],
                ["Lead source", p.leadSource],
                ["Owner", p.owner?.name],
                ["Estimated value", p.estimatedValue != null ? formatMoney(p.estimatedValue, p.currency) : null],
                ["Won value", p.wonValue != null ? formatMoney(p.wonValue, p.currency) : null],
                ["Created", formatDate(p.createdAt)],
                ["Last activity", timeAgo(p.lastActivityAt)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-0.5 font-medium">{v || <span className="font-normal text-muted">—</span>}</dd>
                </div>
              ))}
            </dl>
            {(p.notes || p.lostReason) && (
              <div className="space-y-3 border-t border-border p-5 text-sm">
                {p.lostReason && (
                  <p>
                    <span className="font-medium">Reason lost: </span>
                    {p.lostReason}
                  </p>
                )}
                {p.notes && <p className="whitespace-pre-wrap text-muted">{p.notes}</p>}
              </div>
            )}
          </Card>

          <div className="-mb-3">
            <OptOut prospectId={p.id} on={p.doNotContact} reason={p.doNotContactReason} />
          </div>
          <ContactsPanel prospectId={p.id} contacts={p.contacts} />
          <TrackingCard
            prospectId={p.id}
            gscConnected={!!gscConn}
            siteUrl={track.gscSiteUrl}
            syncedAt={track.gscSyncedAt?.toISOString() ?? null}
            last28={last28.length ? totals(last28) : null}
            prev28={prev28.length >= 20 ? totals(prev28) : null}
            spark={[...last28].reverse().map((d) => d.clicks)}
            checkedAt={track.changesCheckedAt?.toISOString() ?? null}
            tracked={p.status === "WON" || !!track.gscSiteUrl}
            changes={changes.map((c) => ({ id: c.id, url: c.url, label: CHANGE_LABELS[c.kind as ChangeKind] ?? c.kind, before: c.before, after: c.after, at: c.detectedAt.toISOString() }))}
          />

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Website audits" description={`${p.audits.length} total`} />
              {p.audits.length === 0 ? (
                <EmptyState icon={<FileSearch className="h-5 w-5" />} title="No audits yet" />
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {p.audits.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-3">
                      <Link href={`/audits/${a.id}`} className="font-medium hover:text-primary">
                        {formatDate(a.createdAt, true)}
                      </Link>
                      <Badge>{a.status.toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Proposals"
                description={`${p.proposals.length} total`}
                action={
                  <form action={createProposalAction}>
                    <input type="hidden" name="prospectId" value={p.id} />
                    {latestAudit && <input type="hidden" name="auditId" value={latestAudit.id} />}
                    <button type="submit" className={buttonClass("secondary", "sm")} title={latestAudit ? "Uses the latest completed audit" : "No completed audit — creates a proposal without audit findings"}>
                      New proposal
                    </button>
                  </form>
                }
              />
              {p.proposals.length === 0 ? (
                <EmptyState icon={<FileText className="h-5 w-5" />} title="No proposals yet" description="Proposals are generated from a completed audit." />
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {p.proposals.map((pr) => (
                    <li key={pr.id} className="flex items-center justify-between px-5 py-3">
                      <Link href={`/proposals/${pr.id}`} className="font-medium hover:text-primary">
                        {pr.title}
                      </Link>
                      <span className="text-xs text-muted">
                        v{pr.currentVersion} · {pr.status.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Notes, meetings and objections" />
            <div className="p-5">
              <NoteForm prospectId={p.id} />
            </div>
            {p.meetingNotes.length > 0 && (
              <ul className="divide-y divide-border border-t border-border text-sm">
                {p.meetingNotes.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                      <Badge tone={n.kind === "OBJECTION" ? "warning" : n.kind === "MEETING" ? "info" : "neutral"}>
                        {n.kind.toLowerCase()}
                      </Badge>
                      {formatDate(n.createdAt, true)}
                    </div>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {kickoff.length > 0 && <KickoffChecklist prospectId={p.id} tasks={kickoff.map((t) => ({ id: t.id, title: t.title, detail: t.detail, done: t.done }))} />}
          <Card>
            <CardHeader title="Pipeline status" />
            <div className="p-5">
              <StatusChanger
                prospectId={p.id}
                current={p.status}
                currency={p.currency}
                statuses={statuses.map((s) => ({ key: s.key, label: s.label }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Follow-ups" description={p.nextFollowUpAt ? `Next: ${formatDate(p.nextFollowUpAt)}` : "None pending"} />
            {p.followUps.length > 0 && (
              <ul className="divide-y divide-border border-b border-border">
                {p.followUps.map((f) => (
                  <FollowUpRow
                    key={f.id}
                    followUp={{
                      id: f.id,
                      label: FOLLOW_UP_TYPES[f.type as FollowUpType] ?? f.type,
                      dueAt: f.dueAt.toISOString(),
                      status: f.status,
                      note: f.note,
                      proposalId: f.proposalId,
                    }}
                  />
                ))}
              </ul>
            )}
            <div className="p-5">
              <FollowUpForm prospectId={p.id} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Activity history" />
            {p.activities.length === 0 ? (
              <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No activity yet" />
            ) : (
              <ol className="max-h-[32rem] space-y-4 overflow-y-auto p-5">
                {p.activities.map((a) => (
                  <li key={a.id} className="relative border-l-2 border-border pl-4 text-sm">
                    <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
                    <p>{a.message}</p>
                    <p className="text-xs text-muted">
                      {a.user?.name ? `${a.user.name} · ` : ""}
                      <time dateTime={a.createdAt.toISOString()} title={formatDate(a.createdAt, true)}>
                        {timeAgo(a.createdAt)}
                      </time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {isAdmin && (
            <DangerZone
              prospectId={p.id}
              businessName={p.businessName}
              candidates={mergeCandidates}
              likelyDuplicateIds={likelyDuplicates.map((d) => d.id)}
            />
          )}
        </div>
      </div>
    </>
  );
}
