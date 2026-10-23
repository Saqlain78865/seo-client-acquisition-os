import Link from "next/link";
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { ProposalStatusBadge } from "./status";

export const metadata: Metadata = { title: "SEO Proposals" };

export default async function ProposalsPage() {
  const session = await requireSession();
  const proposals = await db.proposal.findMany({
    where: { workspaceId: session.workspace.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { prospect: { select: { id: true, businessName: true, domain: true } } },
  });

  return (
    <>
      <PageHeader title="SEO Proposals" description="Generate a proposal from a completed audit, or from a prospect's page." />
      <Card className="overflow-hidden">
        {proposals.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No proposals yet"
            description="Open a completed audit and choose “Create proposal”."
            action={
              <Link href="/audits" className={buttonClass("primary")}>
                Go to audit reports
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Proposal</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proposals.map((p) => {
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
