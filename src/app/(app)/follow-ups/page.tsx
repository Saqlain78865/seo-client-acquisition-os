import Link from "next/link";
import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { FOLLOW_UP_TYPES, type FollowUpType } from "@/lib/constants";
import { Card, EmptyState, PageHeader, tabBarClass, tabClass } from "@/components/ui";
import { FollowUpRow } from "../prospects/[id]/follow-ups";

export const metadata: Metadata = { title: "Follow-ups" };

const VIEWS = { due: "Due & overdue", upcoming: "Upcoming", paused: "Paused", done: "Completed" } as const;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  const { view: rawView } = await searchParams;
  const view = (rawView && rawView in VIEWS ? rawView : "due") as keyof typeof VIEWS;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const where = {
    due: { status: "PENDING", dueAt: { lte: endOfToday } },
    upcoming: { status: "PENDING", dueAt: { gt: endOfToday } },
    paused: { status: "PAUSED" },
    done: { status: { in: ["DONE", "CANCELLED"] } },
  }[view];

  const items = await db.followUp.findMany({
    where: { workspaceId: session.workspace.id, ...where },
    orderBy: { dueAt: view === "done" ? "desc" : "asc" },
    take: 200,
    include: { prospect: { select: { id: true, businessName: true, domain: true } } },
  });

  return (
    <>
      <PageHeader title="Follow-ups" description="Reminders only — nothing is sent automatically. Schedule follow-ups from a prospect's page." />
      <div className={`${tabBarClass} mb-4`} role="tablist">
        {Object.entries(VIEWS).map(([k, label]) => (
          <Link
            key={k}
            href={`/follow-ups?view=${k}`}
            role="tab"
            aria-selected={view === k}
            className={tabClass(view === k)}
          >
            {label}
          </Link>
        ))}
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<BellRing className="h-5 w-5" />} title="No follow-ups here" />
        ) : (
          <div className="divide-y divide-border">
            {items.map((f) => (
              <div key={f.id} className="grid sm:grid-cols-[14rem_1fr]">
                <div className="px-5 pt-3 sm:py-3">
                  <Link href={`/prospects/${f.prospect.id}`} className="text-sm font-medium hover:text-primary">
                    {f.prospect.businessName}
                  </Link>
                  <p className="text-xs text-muted">{f.prospect.domain}</p>
                </div>
                <ul>
                <FollowUpRow
                  followUp={{
                    id: f.id,
                    label: FOLLOW_UP_TYPES[f.type as FollowUpType] ?? f.type,
                    dueAt: f.dueAt.toISOString(),
                    status: f.status,
                    note: f.result ? `${f.note ?? ""}${f.note ? " · " : ""}Result: ${f.result}` : f.note,
                    proposalId: f.proposalId,
                  }}
                />
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
