import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, Layers, Send } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { SEND_HOURS, campaignRecipients, listCampaigns } from "@/lib/campaigns";
import { formatDate } from "@/lib/utils";
import { Badge, Card, EmptyState, PageHeader, buttonClass, type BadgeTone } from "@/components/ui";
import { CampaignControls } from "./controls";

export const metadata: Metadata = { title: "Auto-send" };

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Sending", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  DONE: { label: "Finished", tone: "info" },
  STOPPED: { label: "Stopped", tone: "neutral" },
};
const ROW: Record<string, BadgeTone> = { SENT: "success", QUEUED: "info", SKIPPED: "neutral", FAILED: "danger" };

export default async function CampaignsPage() {
  const session = await requireSession();
  const campaigns = await listCampaigns(session.workspace.id);
  const details = await Promise.all(campaigns.slice(0, 5).map((c) => campaignRecipients(session.workspace.id, c.id)));

  return (
    <>
      <PageHeader
        title="Auto-send"
        description={`Proposals you approved once, emailed automatically from your Gmail — spread between ${SEND_HOURS.from}:00 and ${SEND_HOURS.to}:00 while LeadLift is open.`}
        actions={
          <Link href="/audits/bulk" className={buttonClass("secondary")}>
            <Layers className="h-4 w-4" /> New bulk audit
          </Link>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="No auto-send yet"
          description="Run a bulk audit with proposals, then choose “Start auto-send” on its results page."
          action={
            <Link href="/audits/bulk" className={buttonClass("primary")}>
              Start a bulk audit
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {campaigns.map((c, i) => {
            const total = c.sent + c.queued + c.skipped + c.failed;
            const st = STATUS[c.status] ?? STATUS.ACTIVE;
            const recipients = details[i];
            return (
              <Card key={c.id} className="overflow-hidden">
                <div className="flex flex-wrap items-start gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{c.name}</h2>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Started {formatDate(c.approvedAt, true)} · up to {c.dailyLimit} a day
                      {c.lastSentAt ? ` · last email ${formatDate(c.lastSentAt, true)}` : ""}
                    </p>
                  </div>
                  <CampaignControls id={c.id} status={c.status} />
                </div>
                <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-4">
                  {[
                    { label: "Sent", value: c.sent, icon: CheckCircle2, tone: "text-success" },
                    { label: "Sent today", value: `${c.sentToday}/${c.dailyLimit}`, icon: Send, tone: "text-primary" },
                    { label: "Waiting", value: c.queued, icon: Clock, tone: "text-info" },
                    { label: "Skipped / failed", value: c.skipped + c.failed, icon: CalendarClock, tone: "text-muted" },
                  ].map((k) => (
                    <div key={k.label} className="rounded-xl bg-surface-2 px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] text-muted">
                        <k.icon className={`h-3.5 w-3.5 ${k.tone}`} /> {k.label}
                      </p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums">{k.value}</p>
                    </div>
                  ))}
                </div>
                <div className="px-5 pb-4">
                  <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-gradient-to-r from-[#10b981] to-[#059669]" style={{ width: `${total ? (c.sent / total) * 100 : 0}%` }} />
                    <div className="h-full bg-surface-2" />
                  </div>
                </div>
                {recipients && recipients.length > 0 && (
                  <details className="border-t border-border">
                    <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-primary hover:bg-surface-2/50">Show the {recipients.length} proposals</summary>
                    <ul className="divide-y divide-border text-sm">
                      {recipients.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                          <Link href={`/proposals/${r.proposal.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                            {r.proposal.prospect.businessName}
                          </Link>
                          <span className="text-xs text-muted">{r.email}</span>
                          {r.reason && <span className="text-xs text-muted">{r.reason}</span>}
                          <Badge tone={ROW[r.status] ?? "neutral"}>{r.status === "SENT" && r.sentAt ? `Sent ${formatDate(r.sentAt, true)}` : r.status.toLowerCase()}</Badge>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
