import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { reputationList } from "@/lib/reputation";
import { formatDate } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { StartReputationForm } from "./start-form";

export const metadata: Metadata = { title: "Reputation" };

const STEPS = [
  ["Add the business", "Its Google Maps link, or just its name and website."],
  ["Collect the bad reviews", "Read from Google with a Places key, pasted, or as your screenshots."],
  ["Check them with AI", "Which may break Google policy (removal can be requested) and which need a reply."],
  ["Send the proposal", "A reputation-only proposal with the reviews, screenshots and your plan."],
];

export default async function ReputationPage() {
  const session = await requireSession();
  const list = await reputationList(session.workspace.id);
  return (
    <>
      <PageHeader title="Reputation" description="Turn a business's bad Google reviews into a reputation proposal it wants to accept." />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card className="p-6">
          <StartReputationForm />
        </Card>
        <Card>
          <CardHeader title="How it works" />
          <ol className="space-y-3 p-5 text-sm">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
                <span>
                  <b className="font-medium">{t}</b>
                  <span className="block text-xs text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Businesses" description="Every business with a Google profile on record" />
        {list.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No businesses yet" description="Start a review check above." />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((b) => (
              <li key={b.prospectId}>
                <Link href={`/prospects/${b.prospectId}/research?tab=gbp`} className="group flex flex-wrap items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-2/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium group-hover:text-primary">{b.businessName}</span>
                    <span className="text-xs text-muted">
                      {b.domain}
                      {b.rating != null ? ` · ${b.rating.toFixed(1)}★ from ${b.reviewCount ?? 0} reviews` : ""} · {formatDate(b.fetchedAt)}
                    </span>
                  </span>
                  <Badge tone={b.negative ? "danger" : "success"}>{b.negative} bad</Badge>
                  {b.checked && <Badge tone={b.policy ? "warning" : "neutral"}>{b.policy} may break policy</Badge>}
                  {b.screenshots > 0 && <Badge tone="info">{b.screenshots} screenshots</Badge>}
                  <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
