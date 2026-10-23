import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, Flame, Loader2, Mail, Snowflake, Sun } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getBatchResults } from "@/lib/audit/bulk";
import type { Opportunity } from "@/lib/audit/opportunity";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Alert, Card, PageHeader, buttonClass, Avatar } from "@/components/ui";
import { AuditStatusBadge } from "../../status";
import { AutoRefresh } from "../../[id]/client-bits";
import { createProposalAction } from "../../../proposals/actions";

export const metadata: Metadata = { title: "Bulk audit results" };

const GRADE = {
  HOT: { label: "Hot lead", icon: Flame, bar: "bg-danger", chip: "bg-danger-soft text-danger" },
  WARM: { label: "Warm", icon: Sun, bar: "bg-warning", chip: "bg-warning-soft text-warning" },
  COLD: { label: "Cold", icon: Snowflake, bar: "bg-info", chip: "bg-info-soft text-info" },
} as const;

function Score({ o }: { o: Opportunity }) {
  const g = GRADE[o.grade];
  return (
    <div className="w-36">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums">{o.score}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", g.chip)}>
          <g.icon className="h-3 w-3" /> {g.label}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full transition-[width] duration-700", g.bar)} style={{ width: `${o.score}%` }} />
      </div>
    </div>
  );
}

export default async function BulkResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await getBatchResults(session.workspace.id, id);
  if (!data) notFound();
  const { batch, rows, active } = data;
  const skipped = (batch.skipped as { site: string; reason: string }[] | null) ?? [];
  const done = rows.length - active;

  return (
    <>
      <AutoRefresh active={active > 0} intervalMs={4000} />
      <PageHeader
        title={batch.name}
        description={`${rows.length} websites · started ${formatDate(batch.createdAt, true)} · ranked by opportunity score`}
        actions={
          <Link href="/audits/bulk" className={buttonClass("secondary")}>
            New bulk audit
          </Link>
        }
      />

      {active > 0 && (
        <Card className="mb-6 p-5">
          <div className="flex items-center gap-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>
              <span className="font-semibold">{done}</span> of {rows.length} websites checked. You can leave this page — you will get a notification when the list is ready.
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-700" style={{ width: `${Math.round((done / Math.max(rows.length, 1)) * 100)}%` }} />
          </div>
        </Card>
      )}

      {skipped.length > 0 && (
        <Alert tone="warning" title={`${skipped.length} website${skipped.length === 1 ? " was" : "s were"} skipped`} className="mb-6">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {skipped.slice(0, 10).map((s) => (
              <li key={s.site}>
                <span className="font-medium">{s.site}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="w-10 px-4 py-3 font-medium">#</th>
                <th scope="col" className="px-4 py-3 font-medium">Website</th>
                <th scope="col" className="px-4 py-3 font-medium">Opportunity</th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Why</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Next step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.auditId} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3 text-muted tabular-nums">{r.opportunity ? i + 1 : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-3">
                    <Avatar name={r.prospect.businessName} />
                    <div className="min-w-0">
                    <Link href={`/audits/${r.auditId}`} className="font-medium hover:text-primary">
                      {r.prospect.businessName}
                    </Link>
                    <p className="text-xs text-muted">{r.prospect.domain}</p>
                    {r.contact && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-success">
                        <Mail className="h-3 w-3" /> {r.contact}
                      </p>
                    )}
                    </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.opportunity ? <Score o={r.opportunity} /> : <AuditStatusBadge status={r.status} />}</td>
                  <td className="hidden max-w-md px-4 py-3 text-xs text-muted lg:table-cell">
                    {r.opportunity ? (
                      <ul className="list-disc space-y-0.5 pl-4">
                        {r.opportunity.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : r.status === "FAILED" ? (
                      "The website could not be audited."
                    ) : (
                      "Waiting for the audit…"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.proposalId ? (
                      <Link href={`/proposals/${r.proposalId}`} className={buttonClass("secondary", "sm")}>
                        <FileText className="h-3.5 w-3.5" /> Open proposal
                      </Link>
                    ) : r.opportunity ? (
                      <form action={createProposalAction} className="inline">
                        <input type="hidden" name="prospectId" value={r.prospect.id} />
                        <input type="hidden" name="auditId" value={r.auditId} />
                        <button type="submit" className={buttonClass("primary", "sm")}>
                          <FileText className="h-3.5 w-3.5" /> Create proposal
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">
        The score combines confirmed issues found on the website (more work needed = bigger opportunity) and whether contact details were found. It ranks leads; it does not measure traffic.
      </p>
    </>
  );
}
