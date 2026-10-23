import { BookOpenCheck, Laptop, Lightbulb, Smartphone } from "lucide-react";
import { formatDuration, readingSummary } from "@/lib/proposals/reading";
import { timeAgo } from "@/lib/utils";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

/** How the client read the shared proposal: time per section and whether they reached the decision parts. */
export async function ReadingCard({ workspaceId, proposalId, shared }: { workspaceId: string; proposalId: string; shared: boolean }) {
  const s = await readingSummary(workspaceId, proposalId);
  if (!s && !shared) return null;

  return (
    <Card>
      <CardHeader title="How the client read it" description="From the share link. Your team's own views are not counted." />
      {!s ? (
        <EmptyState icon={<BookOpenCheck className="h-5 w-5" />} title="Not read yet" description="Reading time per section appears here once the client opens the link." />
      ) : (
        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Visits", String(s.visits)],
              ["Reading time", formatDuration(s.totalMs)],
              ["Last read", timeAgo(s.lastReadAt!)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-2 px-2 py-2.5">
                <dd className="text-sm font-bold tabular-nums">{value}</dd>
                <dt className="text-[11px] text-muted">{label}</dt>
              </div>
            ))}
          </dl>

          <div>
            <p className="mb-2 text-xs font-medium text-muted">Decision sections</p>
            <ul className="space-y-1.5">
              {s.decision.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", d.ms > 0 ? "bg-success" : "bg-warning")} />
                    {d.title}
                  </span>
                  <span className={cn("text-xs tabular-nums", d.ms > 0 ? "font-medium" : "text-warning")}>{d.ms > 0 ? formatDuration(d.ms) : "Not reached"}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted">Time per section</p>
            <ul className="space-y-2">
              {s.sections.slice(0, 8).map((x) => (
                <li key={x.key}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate">{x.title}</span>
                    <span className="shrink-0 font-medium tabular-nums">{formatDuration(x.ms)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${Math.max(4, Math.round((x.ms / s.sections[0].ms) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <CallTip summary={s} />

          <p className="flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Laptop className="h-3.5 w-3.5" /> {s.devices.DESKTOP} on computer
            </span>
            <span className="inline-flex items-center gap-1">
              <Smartphone className="h-3.5 w-3.5" /> {s.devices.MOBILE} on phone
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}

/** One practical line for the follow-up call, worked out from the reading data. */
function CallTip({ summary: s }: { summary: NonNullable<Awaited<ReturnType<typeof readingSummary>>> }) {
  const top = s.sections.find((x) => !["cover", "glance"].includes(x.key));
  const missed = s.decision.filter((d) => d.ms === 0).map((d) => d.title.toLowerCase());
  const tips: string[] = [];
  if (top) tips.push(`They spent longest on “${top.title}” — open the call there.`);
  if (missed.length) tips.push(`They did not reach ${missed.join(", ")} — walk them through it.`);
  else tips.push("They reached every decision section — ask if they are ready to start.");
  if (s.visits > 1) tips.push(`They came back ${s.visits} times — a sign of real interest.`);
  return (
    <div className="rounded-xl border border-primary/20 bg-primary-soft/50 p-3 text-sm">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Lightbulb className="h-3.5 w-3.5" /> For your call
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-text/90">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
