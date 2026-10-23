import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getReports } from "@/lib/reports";
import { formatMoney } from "@/lib/utils";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { MonthlyChart } from "./monthly-chart";

export const metadata: Metadata = { title: "Reports and Analytics" };

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const days = (v: number | null) => (v == null ? "—" : v < 1 ? "< 1 day" : `${Math.round(v)} days`);

export default async function ReportsPage() {
  const session = await requireSession();
  const r = await getReports(session.workspace.id);
  const empty = r.totals.prospects === 0;

  return (
    <>
      <PageHeader title="Reports and Analytics" description="Calculated from the records in this workspace — no sample data." />
      {empty ? (
        <Card>
          <EmptyState title="No data yet" description="Reports fill in as you add prospects, run audits and send proposals." />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Median time: audit → proposal", days(r.medianAuditToProposalDays)],
              ["Median time: proposal → won", days(r.medianProposalToWonDays)],
              ["Win rate (won ÷ closed)", pct(r.totals.won, r.totals.won + r.totals.lost)],
              ["Won value", Object.entries(r.wonValue).map(([c, v]) => formatMoney(v, c)).join(" · ") || formatMoney(0)],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Monthly activity" description="Last 12 months" />
            <div className="p-4">
              <MonthlyChart data={r.monthly} />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader title="Lead source performance" description="Prospects whose proposal was sent, and deals won, by source" />
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-medium">Source</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Prospects</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Proposal sent</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Won</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Win rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.sources.map((s) => (
                    <tr key={s.source}>
                      <td className="px-5 py-2">{s.source}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.prospects}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.sent}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.won}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{pct(s.won, s.prospects)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <CardHeader title="Most common confirmed issues" description={`Across ${r.completedAudits} completed audit${r.completedAudits === 1 ? "" : "s"} — useful for packaging services`} />
              {r.commonIssues.length === 0 ? (
                <EmptyState title="No completed audits yet" />
              ) : (
                <ul className="space-y-3 p-5">
                  {r.commonIssues.map((i) => (
                    <li key={i.ruleId}>
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="truncate">{i.title}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {i.audits} · {i.share}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="presentation">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${i.share}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Proposals by status" />
              <ul className="divide-y divide-border text-sm">
                {Object.entries(r.proposalStatus).map(([s, n]) => (
                  <li key={s} className="flex justify-between px-5 py-2.5">
                    <span>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
                {Object.keys(r.proposalStatus).length === 0 && <li className="px-5 py-3 text-muted">No proposals yet</li>}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Why deals were lost" description="From reasons recorded when marking deals lost" />
              <ul className="divide-y divide-border text-sm">
                {r.lostReasons.map((l) => (
                  <li key={l.reason} className="flex justify-between gap-3 px-5 py-2.5">
                    <span>{l.reason}</span>
                    <span className="tabular-nums text-muted">{l.count}</span>
                  </li>
                ))}
                {r.lostReasons.length === 0 && <li className="px-5 py-3 text-muted">No lost deals recorded</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
