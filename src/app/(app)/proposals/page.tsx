import Link from "next/link";
import type { Metadata } from "next";
import { Eye, FileText, Mail } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, EmptyState, PageHeader, buttonClass, tabBarClass, tabClass } from "@/components/ui";
import { WhatsAppIcon } from "@/components/whatsapp-button";
import { ProposalStatusBadge } from "./status";
import { MarkSentButton } from "./mark-sent-button";

export const metadata: Metadata = { title: "SEO Proposals" };

const WA_SENT = ["MANUAL_SENT", "SENT", "DELIVERED", "READ", "ACCEPTED"];
const VIEWS = { all: "All", draft: "Not sent yet", sent: "Sent", accepted: "Accepted" } as const;
type View = keyof typeof VIEWS;
const WHERE: Record<View, string[] | null> = { all: null, draft: ["DRAFT", "READY"], sent: ["SENT"], accepted: ["ACCEPTED"] };

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="rounded-xl bg-surface-2 p-2">{icon}</span>
      <span>
        <span className="block text-2xl font-bold tabular-nums leading-none">{value}</span>
        <span className="text-xs text-muted">{label}</span>
      </span>
    </Card>
  );
}

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  const { view: raw } = await searchParams;
  const view: View = raw && raw in VIEWS ? (raw as View) : "all";
  const ws = session.workspace.id;
  const statuses = WHERE[view];
  const [proposals, all] = await Promise.all([
    db.proposal.findMany({
      where: { workspaceId: ws, ...(statuses ? { status: { in: statuses } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        prospect: { select: { id: true, businessName: true, domain: true } },
        emailDeliveries: { where: { status: "ACCEPTED" }, select: { sentAt: true }, orderBy: { sentAt: "desc" }, take: 1 },
        whatsappDeliveries: { where: { status: { in: WA_SENT } }, select: { createdAt: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.proposal.findMany({
      where: { workspaceId: ws },
      select: { status: true, shareViews: true, _count: { select: { emailDeliveries: { where: { status: "ACCEPTED" } }, whatsappDeliveries: { where: { status: { in: WA_SENT } } } } } },
    }),
  ]);
  const count = (v: View) => (WHERE[v] ? all.filter((p) => WHERE[v]!.includes(p.status)).length : all.length);
  const byGmail = all.filter((p) => p._count.emailDeliveries > 0).length;
  const byWhatsApp = all.filter((p) => p._count.whatsappDeliveries > 0).length;

  return (
    <>
      <PageHeader title="SEO Proposals" description="Which proposals are still drafts, which went out — and on which channel." />
      {all.length > 0 && (
        <div className="stagger mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Not sent yet" value={count("draft")} icon={<FileText className="h-4 w-4 text-muted" />} />
          <Stat label="Sent by Gmail" value={byGmail} icon={<Mail className="h-4 w-4 text-primary" />} />
          <Stat label="Sent on WhatsApp" value={byWhatsApp} icon={<WhatsAppIcon className="h-4 w-4 text-[#25D366]" />} />
          <Stat label="Opened by the client" value={all.filter((p) => p.shareViews > 0).length} icon={<Eye className="h-4 w-4 text-info" />} />
        </div>
      )}
      <div className={`${tabBarClass} mb-4`} role="tablist">
        {(Object.keys(VIEWS) as View[]).map((k) => (
          <Link key={k} href={`/proposals?view=${k}`} role="tab" aria-selected={view === k} className={tabClass(view === k)}>
            {VIEWS[k]} <span className="tabular-nums opacity-70">{count(k)}</span>
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {proposals.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={view === "all" ? "No proposals yet" : "Nothing here"}
            description={view === "all" ? "Open a completed audit and choose “Create proposal”." : undefined}
            action={
              view === "all" ? (
                <Link href="/audits" className={buttonClass("primary")}>
                  Go to audit reports
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Proposal</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Sent by</th>
                  <th scope="col" className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proposals.map((p) => {
                  const email = p.emailDeliveries[0];
                  const wa = p.whatsappDeliveries[0];
                  return (
                    <tr key={p.id} className="hover:bg-surface-2/50">
                      <td className="px-4 py-3">
                        <Link href={`/proposals/${p.id}`} className="font-medium hover:text-primary">
                          {p.title}
                        </Link>
                        <div className="text-xs text-muted">
                          {p.prospect.domain} · v{p.currentVersion}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ProposalStatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {email && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 font-medium text-primary">
                              <Mail className="h-3 w-3" /> Gmail · {formatDate(email.sentAt)}
                            </span>
                          )}
                          {wa && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/15 px-2 py-0.5 font-medium text-[#128C7E]">
                              <WhatsAppIcon className="h-3 w-3" /> WhatsApp · {formatDate(wa.createdAt)}
                              {wa.status === "READ" && " · seen"}
                            </span>
                          )}
                          {!email && !wa && (p.status === "DRAFT" || p.status === "READY") && <MarkSentButton proposalId={p.id} />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(p.updatedAt, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
