import Link from "next/link";
import type { Metadata } from "next";
import {
  Activity,
  BellRing,
  CheckCircle2,
  Clock,
  FileSearch,
  FileText,
  Send,
  ThumbsDown,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboardData, type MoneyByCurrency } from "@/lib/dashboard";
import { formatDate, formatMoney, timeAgo } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DeliveryChart, HorizontalBarChart, ProspectsOverTimeChart } from "./dashboard-charts";
import { QuickAudit } from "./quick-audit";
import { HeroReel } from "./hero-reel";

const KPI_TONES = {
  indigo: "from-[#6366f1] to-[#8b5cf6]",
  blue: "from-[#3b82f6] to-[#06b6d4]",
  green: "from-[#10b981] to-[#059669]",
  amber: "from-[#f59e0b] to-[#f97316]",
  rose: "from-[#f43f5e] to-[#e11d48]",
  slate: "from-[#64748b] to-[#475569]",
} as const;

export const metadata: Metadata = { title: "Overview" };

function Kpi({ label, value, icon: Icon, hint, href, tone = "indigo" }: { label: string; value: React.ReactNode; icon: LucideIcon; hint?: string; href?: string; tone?: keyof typeof KPI_TONES }) {
  const body = (
    <Card interactive={!!href} className="spotlight group relative h-full overflow-hidden p-4">
      <div className={cn("pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full bg-gradient-to-br opacity-[0.08] transition-opacity duration-300 group-hover:opacity-[0.16]", KPI_TONES[tone])} />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={cn("rounded-lg bg-gradient-to-br p-1.5 text-white shadow-sm", KPI_TONES[tone])}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
      <div className="relative mt-3 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <p className="relative mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

function Money({ values }: { values: MoneyByCurrency }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return <>{formatMoney(0)}</>;
  return (
    <span className="flex flex-col">
      {entries.map(([cur, v]) => (
        <span key={cur} className={entries.length > 1 ? "text-lg" : undefined}>
          {formatMoney(v, cur)}
        </span>
      ))}
    </span>
  );
}

export default async function OverviewPage() {
  const session = await requireSession();
  const [d, latest] = await Promise.all([
    getDashboardData(session.workspace.id),
    db.activityLog.findMany({ where: { workspaceId: session.workspace.id, prospectId: { not: null } }, orderBy: { createdAt: "desc" }, take: 6, select: { message: true, createdAt: true, prospect: { select: { businessName: true } } } }),
  ]);
  // Real recent events for the live ticker in the hero.
  const ticker = latest.map((a) => ({
    at: a.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    text: `${a.prospect?.businessName ?? ""} — ${a.message}`,
  }));
  const k = d.kpis;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.user.name.split(" ")[0]}`}
        description="Every number here is calculated from records saved in this workspace."
        actions={
          <Link href="/audits/bulk" className={buttonClass("secondary")}>
            Bulk audit
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <QuickAudit ticker={ticker} />
        <HeroReel />
      </div>

      <section aria-label="Key metrics" className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total prospects" value={k.totalProspects} icon={Users} href="/prospects" tone="indigo" />
        <Kpi label="Audits completed" value={k.auditsCompleted} icon={FileSearch} href="/audits" tone="blue" />
        <Kpi label="Proposals generated" value={k.proposalsGenerated} icon={FileText} href="/proposals" tone="indigo" />
        <Kpi label="Proposals sent" value={k.proposalsSent} icon={Send} tone="blue" />
        <Kpi label="Awaiting response" value={k.awaiting} icon={Clock} href="/prospects?status=PROPOSAL_SENT" tone="amber" />
        <Kpi label="Follow-ups due" value={k.followUpsDue} icon={BellRing} hint="Due today or overdue" href="/follow-ups" tone="amber" />
        <Kpi label="Deals won" value={k.dealsWon} icon={Trophy} href="/deals" tone="green" />
        <Kpi label="Deals lost" value={k.dealsLost} icon={ThumbsDown} href="/deals" tone="rose" />
        <Kpi label="Total quoted value" value={<Money values={k.quoted} />} icon={Wallet} hint="Proposed, not earned" tone="slate" />
        <Kpi label="Total won value" value={<Money values={k.won} />} icon={CheckCircle2} hint="Agreed on won deals" tone="green" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="reveal lg:col-span-2">
          <CardHeader title="Prospects created" description="Per week, last 12 weeks" />
          <div className="p-4">
            {k.totalProspects === 0 ? (
              <EmptyState title="No prospects yet" description="The chart fills in as you add prospects or run audits." />
            ) : (
              <ProspectsOverTimeChart data={d.prospectsOverTime} />
            )}
          </div>
        </Card>

        <Card className="reveal">
          <CardHeader title="Conversion" description="Share of prospects reaching the next stage" />
          <ul className="space-y-4 p-5">
            {d.conversions.map((c) => (
              <li key={c.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{c.label}</span>
                  <span className="font-semibold tabular-nums">{c.rate == null ? "—" : `${c.rate}%`}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="presentation">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-700" style={{ width: `${c.rate ?? 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {c.denominator === 0 ? "Not enough data yet" : `${c.numerator} of ${c.denominator}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="reveal">
          <CardHeader title="Leads by source" />
          <div className="p-4">
            {d.leadSources.length === 0 ? (
              <EmptyState title="No data yet" />
            ) : (
              <HorizontalBarChart data={d.leadSources} dataKey="count" categoryKey="source" name="Prospects" />
            )}
          </div>
        </Card>

        <Card className="reveal">
          <CardHeader title="Proposal delivery by channel" description="Provider acceptance, not read receipts" />
          <div className="p-4">
            {d.deliveries.every((x) => x.accepted + x.failed + x.manual === 0) ? (
              <EmptyState title="Nothing sent yet" />
            ) : (
              <DeliveryChart data={d.deliveries} />
            )}
          </div>
        </Card>

        <Card className="reveal lg:col-span-1">
          <CardHeader title="Follow-ups due this week" action={<Link href="/follow-ups" className="text-xs text-primary hover:underline">View all</Link>} />
          {d.followUpsThisWeek.length === 0 ? (
            <EmptyState icon={<BellRing className="h-5 w-5" />} title="Nothing due this week" />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {d.followUpsThisWeek.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link href={`/prospects/${f.prospect.id}`} className="truncate font-medium hover:text-primary">
                    {f.prospect.businessName}
                  </Link>
                  <span className={f.dueAt < new Date() ? "shrink-0 text-xs text-danger" : "shrink-0 text-xs text-muted"}>
                    {formatDate(f.dueAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="reveal lg:col-span-2">
          <CardHeader title="Recent websites" description="The last websites you audited, and where each one is now" />
          {d.recentWebsites.length === 0 ? (
            <EmptyState icon={<Activity className="h-5 w-5" />} title="Nothing yet" description="Audit a website above and it will show here." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {d.recentWebsites.map((w) => (
                <li key={w.prospectId}>
                  <Link href={`/prospects/${w.prospectId}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{w.domain}</span>
                      {w.name !== w.domain && <span className="block truncate text-xs text-muted">{w.name}</span>}
                    </span>
                    <Badge tone={w.tone}>{w.stage}</Badge>
                    <time className="w-20 shrink-0 text-right text-xs text-muted" dateTime={w.at.toISOString()}>
                      {timeAgo(w.at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
