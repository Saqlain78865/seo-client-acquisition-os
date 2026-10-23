import Link from "next/link";
import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/utils";
import { Badge, Card, EmptyState, PageHeader, Avatar } from "@/components/ui";

export const metadata: Metadata = { title: "Clients and Deals" };

export default async function DealsPage() {
  const session = await requireSession();
  const deals = await db.deal.findMany({
    where: { workspaceId: session.workspace.id },
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    include: { prospect: { select: { id: true, businessName: true, domain: true, kickoffTasks: { select: { done: true } } } } },
  });

  return (
    <>
      <PageHeader
        title="Clients and Deals"
        description="Deals are recorded when a prospect is marked Won or Lost, or when a client accepts a proposal online. Won clients get a kickoff checklist."
      />
      <Card className="overflow-hidden">
        {deals.length === 0 ? (
          <EmptyState icon={<Briefcase className="h-5 w-5" />} title="No closed deals yet" description="Mark a prospect as Won or Lost from its pipeline status panel." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Client</th>
                  <th scope="col" className="px-4 py-3 font-medium">Outcome</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Value</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Reason lost</th>
                  <th scope="col" className="px-4 py-3 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deals.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-3">
                      <Avatar name={d.prospect.businessName} />
                      <div className="min-w-0">
                      <Link href={`/prospects/${d.prospect.id}`} className="font-medium hover:text-primary">
                        {d.prospect.businessName}
                      </Link>
                      <div className="text-xs text-muted">{d.prospect.domain}</div>
                      {d.stage === "WON" && d.prospect.kickoffTasks.length > 0 && (
                        <Link href={`/prospects/${d.prospect.id}`} className="mt-1 inline-flex">
                          <Badge tone={d.prospect.kickoffTasks.every((t) => t.done) ? "success" : "primary"}>
                            Onboarding {d.prospect.kickoffTasks.filter((t) => t.done).length}/{d.prospect.kickoffTasks.length}
                          </Badge>
                        </Link>
                      )}
                      </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={d.stage === "WON" ? "success" : d.stage === "LOST" ? "danger" : "neutral"}>{d.stage.toLowerCase()}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(d.value, d.currency)}
                      {d.stage !== "WON" && d.value != null && <div className="text-xs text-muted">estimate</div>}
                    </td>
                    <td className="hidden max-w-xs truncate px-4 py-3 text-muted md:table-cell">{d.lostReason ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(d.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
