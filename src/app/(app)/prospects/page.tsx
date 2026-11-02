import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Download, MapPin, Plus, Users } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { refreshLeadScores } from "@/lib/lead-score";
import { listProspects, PROSPECT_SORTS } from "@/lib/prospects";
import { getPipelineStatuses } from "@/lib/workspace";
import { formatDate, formatMoney } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, buttonClass, Avatar } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { ProspectsReel } from "../page-reels";

export const metadata: Metadata = { title: "Prospects" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SORT_LABELS: Record<keyof typeof PROSPECT_SORTS, string> = {
  recent: "Newest first",
  hottest: "Hottest leads",
  oldest: "Oldest first",
  name: "Business name",
  activity: "Last activity",
  value: "Estimated value",
  followUp: "Next follow-up",
};

export default async function ProspectsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters = {
    q: str("q"),
    status: str("status"),
    country: str("country"),
    service: str("service"),
    ownerId: str("owner"),
    from: str("from"),
    to: str("to"),
    sort: str("sort"),
    page: Number(str("page") ?? 1) || 1,
  };

  // New prospects get their lead score straight away (it is refreshed every 15 minutes after that).
  if (await db.prospect.count({ where: { workspaceId: session.workspace.id, leadScore: null } })) await refreshLeadScores(session.workspace.id);

  const [result, statuses, countries, members] = await Promise.all([
    listProspects(session.workspace.id, filters),
    getPipelineStatuses(session.workspace.id),
    db.prospect.findMany({
      where: { workspaceId: session.workspace.id, country: { not: null } },
      distinct: ["country"],
      select: { country: true },
      orderBy: { country: "asc" },
    }),
    db.workspaceMembership.findMany({
      where: { workspaceId: session.workspace.id },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const statusLabel = new Map(statuses.map((s) => [s.key, s.label]));

  const qs = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")), ...overrides })) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    return `?${params.toString()}`;
  };
  const hasFilters = Object.entries(filters).some(([k, v]) => k !== "page" && k !== "sort" && v);

  return (
    <>
      <PageHeader
        title="Prospects"
        description={`${result.total} ${result.total === 1 ? "prospect" : "prospects"}${hasFilters ? " match your filters" : " in this workspace"}`}
        actions={
          <>
            <a href={`/api/prospects/export${qs({ page: undefined })}`} className={buttonClass("secondary")}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
            <Link href="/prospects/finder" className={buttonClass("secondary")}>
              <MapPin className="h-4 w-4" /> Prospect Finder
            </Link>
            <Link href="/prospects/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> Add prospect
            </Link>
          </>
        }
      />

      <ProspectsReel className="mb-6" />

      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
          <Input
            name="q"
            defaultValue={filters.q}
            placeholder="Search name, URL, email or phone"
            aria-label="Search prospects"
            className="lg:col-span-2"
          />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label="Filter by status">
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select name="country" defaultValue={filters.country ?? ""} aria-label="Filter by country">
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.country} value={c.country!}>
                {c.country}
              </option>
            ))}
          </Select>
          <Select name="owner" defaultValue={filters.ownerId ?? ""} aria-label="Filter by owner">
            <option value="">All owners</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.name}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort ?? "recent"} aria-label="Sort by">
            {Object.entries(SORT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          <Input name="service" defaultValue={filters.service} placeholder="Service contains…" aria-label="Filter by service" />
          <Input name="from" type="date" defaultValue={filters.from} aria-label="Created from" />
          <Input name="to" type="date" defaultValue={filters.to} aria-label="Created to" />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3 lg:justify-end">
            {hasFilters && (
              <Link href="/prospects" className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
            <Button type="submit" variant="secondary">
              Apply filters
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={hasFilters ? "No prospects match these filters" : "No prospects yet"}
            description={
              hasFilters
                ? "Try a different search or clear the filters."
                : "Add a prospect manually, or start a website audit and the prospect will be created for you."
            }
            action={
              !hasFilters && (
                <Link href="/prospects/new" className={buttonClass("primary")}>
                  <Plus className="h-4 w-4" /> Add prospect
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Business</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell" title="Lead score 0–100: needs (website and Google profile weaknesses) plus warmth (replies, proposal views, stage)">Score</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Contact</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Location</th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">Est. value</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium xl:table-cell">Next follow-up</th>
                  <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.rows.map((p) => {
                  const email = p.contacts.find((c) => c.type === "EMAIL");
                  const phone = p.contacts.find((c) => c.type === "WHATSAPP") ?? p.contacts.find((c) => c.type === "PHONE");
                  const overdue = p.nextFollowUpAt && p.nextFollowUpAt < new Date();
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={p.businessName} />
                          <div className="min-w-0">
                            <Link href={`/prospects/${p.id}`} className="font-medium text-text hover:text-primary">
                              {p.businessName}
                            </Link>
                            <div className="text-xs text-muted">{p.domain}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} label={statusLabel.get(p.status)} />
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {p.leadScore == null ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <span
                            title={((p.leadScoreReasons as string[] | null) ?? []).join(" · ")}
                            className={`inline-flex min-w-10 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${p.leadScore >= 60 ? "bg-danger-soft text-danger" : p.leadScore >= 35 ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted"}`}
                          >
                            {p.leadScore >= 60 ? "🔥 " : ""}
                            {p.leadScore}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-xs md:table-cell">
                        {email && <div className="truncate">{email.value}</div>}
                        {phone && <div className="text-muted">{phone.value}</div>}
                        {!email && !phone && <span className="text-muted">—</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-muted lg:table-cell">
                        {[p.city, p.country].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                        {formatMoney(p.estimatedValue, p.currency)}
                      </td>
                      <td className="hidden px-4 py-3 xl:table-cell">
                        {p.nextFollowUpAt ? (
                          <Badge tone={overdue ? "danger" : "neutral"}>{formatDate(p.nextFollowUpAt)}</Badge>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-muted lg:table-cell">{formatDate(p.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {result.pageCount > 1 && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-3 text-sm" aria-label="Pagination">
            <span className="text-muted">
              Page {result.page} of {result.pageCount}
            </span>
            <div className="flex gap-2">
              {result.page > 1 ? (
                <Link href={qs({ page: result.page - 1 })} className={buttonClass("secondary", "sm")}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Link>
              ) : null}
              {result.page < result.pageCount ? (
                <Link href={qs({ page: result.page + 1 })} className={buttonClass("secondary", "sm")}>
                  Next <ChevronRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
