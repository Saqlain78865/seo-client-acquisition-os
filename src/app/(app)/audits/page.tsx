import Link from "next/link";
import type { Metadata } from "next";
import { FileSearch, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { AuditStatusBadge } from "./status";

export const metadata: Metadata = { title: "Audit Reports" };

export default async function AuditsPage() {
  const session = await requireSession();
  const audits = await db.websiteAudit.findMany({
    where: { workspaceId: session.workspace.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      prospect: { select: { id: true, businessName: true, domain: true } },
      crawlJob: { select: { pagesCrawled: true } },
      findings: { select: { severity: true, evidenceStatus: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Audit Reports"
        description="Every audit keeps its crawled pages, evidence and findings."
        actions={
          <Link href="/audits/new" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" /> New audit
          </Link>
        }
      />
      <Card className="overflow-hidden">
        {audits.length === 0 ? (
          <EmptyState
            icon={<FileSearch className="h-5 w-5" />}
            title="No audits yet"
            description="Enter a prospect's website URL to run the first audit."
            action={
              <Link href="/audits/new" className={buttonClass("primary")}>
                Start an audit
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Website</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">Pages</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Confirmed issues</th>
                  <th scope="col" className="px-4 py-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audits.map((a) => {
                  const confirmed = a.findings.filter((f) => f.evidenceStatus === "CONFIRMED" && ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(f.severity));
                  const critical = confirmed.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length;
                  return (
                    <tr key={a.id} className="hover:bg-surface-2/50">
                      <td className="px-4 py-3">
                        <Link href={`/audits/${a.id}`} className="font-medium hover:text-primary">
                          {a.prospect.domain}
                        </Link>
                        <div className="text-xs text-muted">{a.prospect.businessName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <AuditStatusBadge status={a.status} />
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{a.crawlJob?.pagesCrawled ?? "—"}</td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {a.status === "COMPLETED" || a.status === "PARTIAL" ? (
                          <span>
                            {confirmed.length}
                            {critical > 0 && <span className="text-danger"> ({critical} high/critical)</span>}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(a.createdAt, true)}</td>
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
