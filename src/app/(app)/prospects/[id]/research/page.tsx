import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { IMPORT_KINDS, IMPORT_SOURCES } from "@/lib/research/csv";
import { INTENT_LABELS, type Intent } from "@/lib/research/keywords";
import type { FieldMetrics, LabMetrics } from "@/lib/research/pagespeed";
import { PAGE_TYPE_LABELS, type PageType } from "@/lib/crawler/classify";
import { formatDate, cn } from "@/lib/utils";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass, type BadgeTone, tabBarClass, tabClass } from "@/components/ui";
import { AddCompetitorForm, AddKeywordsForm, CompetitorButtons, DeleteImportButton, DomainCheckButton, ImportForm, KeywordActions, PageSpeedButtons, ProposalKeywordBar, ProposalKeywordToggle } from "./controls";
import { DOMAIN_SOURCES, type DomainOverview } from "@/lib/research/domain";
import { getApiKey } from "@/lib/integrations";
import { defaultGbpQueries, gbpRowToData, latestGbp } from "@/lib/research/service";
import { GbpPanel } from "./gbp-panel";
import { MapsGrid } from "./maps-grid";
import { CompetitorsForm } from "./competitors-form";
import { latestGridScan } from "@/lib/research/places-service";

export const metadata: Metadata = { title: "Research" };

const TABS = { keywords: "Keywords", gbp: "Google Business", domain: "Domain overview", competitors: "Competitors", gsc: "Search Console", backlinks: "Backlinks", performance: "Performance", imports: "Imports" } as const;
type Tab = keyof typeof TABS;

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  MAPPED: { label: "has page", tone: "success" },
  GAP: { label: "content gap", tone: "warning" },
  OVERLAP: { label: "pages overlap", tone: "danger" },
  IDEA: { label: "idea", tone: "neutral" },
  NEW: { label: "new", tone: "neutral" },
};

const num = (n: number | null | undefined, digits = 0) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits }));
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const CAT_TONE: Record<string, BadgeTone> = { FAST: "success", AVERAGE: "warning", SLOW: "danger" };

export default async function ResearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const prospect = await db.prospect.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!prospect) notFound();
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "keywords";

  const [clusters, unclustered, imports, gscQueries, gscPages, refDomains, competitors, tests, latestAudit, domainChecks] = await Promise.all([
    db.keywordCluster.findMany({ where: { prospectId: id }, include: { keywords: { orderBy: { priority: "desc" } } } }),
    db.keyword.count({ where: { prospectId: id, clusterId: null } }),
    db.dataImport.findMany({ where: { prospectId: id }, orderBy: { createdAt: "desc" } }),
    tab === "gsc" ? db.searchConsoleRow.findMany({ where: { prospectId: id, dimension: "QUERY" }, orderBy: { clicks: "desc" }, take: 100 }) : [],
    tab === "gsc" ? db.searchConsoleRow.findMany({ where: { prospectId: id, dimension: "PAGE" }, orderBy: { clicks: "desc" }, take: 50 }) : [],
    tab === "backlinks" ? db.referringDomain.findMany({ where: { prospectId: id }, orderBy: [{ authority: "desc" }], take: 200 }) : [],
    db.competitor.findMany({ where: { prospectId: id }, include: { observations: { orderBy: { observedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } }),
    db.performanceTest.findMany({ where: { prospectId: id }, orderBy: { testedAt: "desc" }, take: 10 }),
    db.websiteAudit.findFirst({ where: { prospectId: id, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, include: { pages: { select: { pageType: true, wordCount: true } } } }),
    tab === "domain" ? db.domainCheck.findMany({ where: { prospectId: id }, orderBy: { checkedAt: "desc" }, take: 100 }) : [],
  ]);
  // Latest check per domain row: the prospect (competitorId null) and each competitor.
  const latestCheck = (competitorId: string | null) => domainChecks.find((c) => c.competitorId === competitorId);
  const sortedClusters = [...clusters].sort((a, b) => Math.max(0, ...b.keywords.map((k) => k.priority)) - Math.max(0, ...a.keywords.map((k) => k.priority)));
  const allKeywords = clusters.flatMap((c) => c.keywords);
  const withMetrics = allKeywords.filter((k) => k.searchVolume != null).length;
  const aiReady = !!(await getApiKey(session.workspace.id, "GEMINI"));
  const gbpRow = tab === "gbp" ? await latestGbp(id) : null;
  const gscImports = imports.filter((i) => i.kind.startsWith("GSC"));

  return (
    <>
      <Link href={`/prospects/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> {prospect.businessName}
      </Link>
      <PageHeader title="Research" description={`Keywords, competitors and imported data for ${prospect.domain}. Every number shows where it came from.`} />

      <div className={`${tabBarClass} mb-5`} role="tablist">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={`?tab=${t}`} role="tab" aria-selected={tab === t} className={tabClass(tab === t)}>
            {TABS[t]}
          </Link>
        ))}
      </div>

      {tab === "gbp" && (
        <GbpPanel
          prospectId={id}
          businessName={prospect.businessName}
          domain={prospect.domain}
          gbp={gbpRow ? gbpRowToData(gbpRow) : null}
          fetchedAt={gbpRow?.fetchedAt ?? null}
          placesReady={!!(await getApiKey(session.workspace.id, "PLACES"))}
          defaultQueries={await defaultGbpQueries(session.workspace.id, id)}
        />
      )}
      {tab === "gbp" && (
        <div className="mt-6">
          <CompetitorsForm
            prospectId={id}
            hasProfile={!!gbpRow}
            defaultQuery={(await defaultGbpQueries(session.workspace.id, id))[0] ?? ""}
            current={
              gbpRow && Array.isArray(gbpRow.competitors) && gbpRow.competitors.length
                ? {
                    query: ((gbpRow.rankings as { query: string; position: number | null }[] | null) ?? [])[0]?.query ?? "",
                    ownPosition: ((gbpRow.rankings as { query: string; position: number | null }[] | null) ?? [])[0]?.position ?? null,
                    competitors: gbpRow.competitors as { name: string; rating: number | null; reviewCount: number; position: number }[],
                  }
                : null
            }
          />
        </div>
      )}
      {tab === "gbp" && (
        <div className="mt-6">
          <MapsGrid
            prospectId={id}
            ready={!!gbpRow?.placeId && !!(await getApiKey(session.workspace.id, "PLACES"))}
            defaultQuery={(await defaultGbpQueries(session.workspace.id, id))[0] ?? ""}
            scan={await latestGridScan(session.workspace.id, id).then((s) => (s ? { query: s.query, size: s.size, spacingKm: s.spacingKm, centerLat: s.centerLat, centerLng: s.centerLng, points: s.points, at: s.createdAt.toISOString() } : null))}
          />
        </div>
      )}

      {tab === "keywords" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Keywords", allKeywords.length + unclustered],
              ["With search data", withMetrics],
              ["Clusters", clusters.length],
              ["Content gaps", allKeywords.filter((k) => k.status === "GAP").length],
              ["Overlapping pages", allKeywords.filter((k) => k.status === "OVERLAP").length],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </Card>
            ))}
          </div>
          {!latestAudit && <Alert tone="info">Run a website audit to map keywords to existing pages and find content gaps.</Alert>}
          {allKeywords.length > 0 && withMetrics === 0 && (
            <Alert tone="warning" title="No search volumes yet">
              Volume, difficulty and CPC are never estimated by this app. Import a keyword export from Ahrefs or Semrush (Imports tab) to add them.
            </Alert>
          )}
          <Card>
            <CardHeader title="Build the keyword list" action={<KeywordActions prospectId={id} aiReady={aiReady} />} />
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <AddKeywordsForm prospectId={id} />
              <p className="text-sm text-muted">
                <strong>AI keyword ideas</strong> uses your free Gemini key to suggest searches from the audited pages, services and locations — ideas only, with no made-up volumes. Other ideas come from the prospect&apos;s services and target locations. Clusters group keywords that one page can target, and each cluster is matched to the best existing page from the latest audit. <strong>Priority</strong> combines
                intent, imported demand, difficulty, whether a page exists, and positions 4–20 (&quot;striking distance&quot;).
              </p>
            </div>
          </Card>
          {allKeywords.length > 0 && <ProposalKeywordBar prospectId={id} chosen={allKeywords.filter((k) => k.inProposal).length} total={allKeywords.length} />}
          {sortedClusters.length === 0 ? (
            <Card>
              <EmptyState title="No keywords yet" description="Generate ideas from services, add keywords manually, or import a keyword export." />
            </Card>
          ) : (
            sortedClusters.map((c) => (
              <Card key={c.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                  <h2 className="font-semibold">{c.name}</h2>
                  {c.intent && <Badge tone="primary">{INTENT_LABELS[c.intent as Intent]}</Badge>}
                  <span className="ml-auto text-xs text-muted">
                    {c.targetUrl ? (
                      <>
                        Target page:{" "}
                        <a href={c.targetUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                          {new URL(c.targetUrl).pathname}
                        </a>
                      </>
                    ) : latestAudit ? (
                      <>No existing page — suggested: {PAGE_TYPE_LABELS[(c.keywords[0]?.recommendedPageType ?? "SERVICE") as PageType]}</>
                    ) : (
                      "Not mapped yet"
                    )}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th scope="col" className="w-10 py-2 pl-5 font-medium">
                          <span className="sr-only">In proposal</span>
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">Keyword</th>
                        <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Intent</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Volume</th>
                        <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">KD</th>
                        <th scope="col" className="hidden px-3 py-2 text-right font-medium lg:table-cell">CPC</th>
                        <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Position</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Priority</th>
                        <th scope="col" className="hidden px-5 py-2 font-medium md:table-cell">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {c.keywords.map((k) => (
                        <tr key={k.id} className={k.inProposal ? "bg-primary-soft/30" : undefined}>
                          <td className="py-2 pl-5 align-top">
                            <ProposalKeywordToggle prospectId={id} keywordId={k.id} keyword={k.keyword} checked={k.inProposal} />
                          </td>
                          <td className="px-3 py-2">
                            {k.keyword}
                            {k.note && <div className="text-xs text-text/70">{k.note}</div>}
                            <div className="text-[11px] text-muted" title={k.retrievedAt ? `Retrieved ${formatDate(k.retrievedAt, true)}` : undefined}>
                              {k.dataSource}
                            </div>
                          </td>
                          <td className="hidden px-3 py-2 text-muted md:table-cell">{k.intent ? INTENT_LABELS[k.intent as Intent] : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {num(k.searchVolume)}
                            {k.searchVolume != null && k.volumeIsEstimate && <span className="ml-1 text-[10px] text-muted">est.</span>}
                          </td>
                          <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{num(k.difficulty)}</td>
                          <td className="hidden px-3 py-2 text-right tabular-nums lg:table-cell">{num(k.cpc, 2)}</td>
                          <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{num(k.currentRank)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{k.priority}</td>
                          <td className="hidden px-5 py-2 md:table-cell">
                            <Badge tone={STATUS_BADGE[k.status]?.tone ?? "neutral"}>{STATUS_BADGE[k.status]?.label ?? k.status.toLowerCase()}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "imports" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <Card>
            <CardHeader title="Imported files" description="Third-party metrics are estimates; Search Console data is measured by Google." />
            {imports.length === 0 ? (
              <EmptyState title="Nothing imported yet" />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {imports.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.fileName}</p>
                      <p className="text-xs text-muted">
                        {IMPORT_SOURCES[i.source as keyof typeof IMPORT_SOURCES]} · {IMPORT_KINDS[i.kind as keyof typeof IMPORT_KINDS]} · {i.rowCount} rows{i.skippedRows ? ` (${i.skippedRows} skipped)` : ""}
                        {i.periodLabel ? ` · ${i.periodLabel}` : ""} · {formatDate(i.createdAt, true)}
                      </p>
                    </div>
                    <Badge tone={i.isEstimate ? "warning" : "success"}>{i.isEstimate ? "estimates" : "measured"}</Badge>
                    <DeleteImportButton prospectId={id} importId={i.id} label={i.fileName} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Import a CSV export" />
            <div className="p-5">
              <ImportForm prospectId={id} />
              <div className="mt-5 space-y-1 text-xs text-muted">
                <p className="font-medium text-text">Where to export</p>
                <p>Ahrefs: Keywords Explorer / Organic keywords / Referring domains → Export.</p>
                <p>Semrush: Keyword Magic Tool / Organic Research / Backlinks → Export CSV.</p>
                <p>Search Console: Performance → Export → Download CSV (unzip, then upload Queries.csv or Pages.csv).</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "gsc" && (
        <div className="space-y-6">
          {gscImports.length === 0 ? (
            <Card>
              <EmptyState title="No Search Console data yet" description="Ask the client for a Performance export (or access), then upload Queries.csv / Pages.csv in the Imports tab." action={<Link href="?tab=imports" className={buttonClass("primary")}>Import data</Link>} />
            </Card>
          ) : (
            <>
              <Alert tone="success" title="Measured by Google">
                Clicks, impressions and average positions below come from Search Console exports ({gscImports.map((i) => `${i.fileName}${i.periodLabel ? `, ${i.periodLabel}` : ""}`).join("; ")}).
              </Alert>
              {[
                ["Top queries", gscQueries],
                ["Top pages", gscPages],
              ].map(([title, rows]) =>
                (rows as typeof gscQueries).length ? (
                  <Card key={title as string} className="overflow-hidden">
                    <CardHeader title={title as string} />
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-wide text-muted">
                          <tr>
                            <th scope="col" className="px-5 py-2 font-medium">{title === "Top queries" ? "Query" : "Page"}</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Clicks</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Impressions</th>
                            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">CTR</th>
                            <th scope="col" className="px-5 py-2 text-right font-medium">Avg. position</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {(rows as typeof gscQueries).map((r) => (
                            <tr key={r.id}>
                              <td className="max-w-md truncate px-5 py-2">{r.value}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(r.clicks)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{num(r.impressions)}</td>
                              <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{r.ctr != null ? `${num(r.ctr, 2)}%` : "—"}</td>
                              <td className={cn("px-5 py-2 text-right tabular-nums", r.position && r.position >= 4 && r.position <= 20 && "font-semibold text-primary")}>{num(r.position, 1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                ) : null,
              )}
              <p className="text-xs text-muted">Highlighted positions (4–20) are “striking distance” queries that are usually the quickest wins.</p>
            </>
          )}
        </div>
      )}

      {tab === "backlinks" && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Referring domains (${refDomains.length})`}
            description={refDomains[0]?.authorityMetric ? `Authority column: ${refDomains[0].authorityMetric} — a third-party estimate, not a Google metric.` : "Import a referring domains or backlinks export to see data."}
          />
          {refDomains.length === 0 ? (
            <EmptyState title="No backlink data" description="No claims are made about links until real data is imported." action={<Link href="?tab=imports" className={buttonClass("primary")}>Import data</Link>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-medium">Domain</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Authority (est.)</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Links</th>
                    <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Follow</th>
                    <th scope="col" className="hidden px-5 py-2 font-medium md:table-cell">First seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {refDomains.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2">{r.domain}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(r.authority)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(r.backlinks)}</td>
                      <td className="hidden px-3 py-2 text-muted sm:table-cell">{r.dofollow == null ? "—" : r.dofollow ? "dofollow" : "nofollow"}</td>
                      <td className="hidden px-5 py-2 text-muted md:table-cell">{formatDate(r.firstSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "domain" && (
        <DomainOverviewTab
          prospectId={id}
          rows={[
            { key: "prospect", competitorId: null, label: prospect.businessName, domain: prospect.domain, check: latestCheck(null) },
            ...competitors.map((c) => ({ key: c.id, competitorId: c.id, label: c.businessName ?? c.domain, domain: c.domain, check: latestCheck(c.id) })),
          ]}
        />
      )}

      {tab === "competitors" && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Add a competitor" description="Choose businesses that actually appear for your prospect's priority searches in their market — not just the biggest website." />
            <div className="p-5">
              <AddCompetitorForm prospectId={id} />
            </div>
          </Card>
          {latestAudit && (
            <p className="text-sm text-muted">
              Your prospect (latest audit): {latestAudit.pages.length} pages · {latestAudit.pages.filter((p) => p.pageType === "SERVICE" || p.pageType === "PRODUCT").length} service / tour pages · {latestAudit.pages.filter((p) => p.pageType === "LOCATION").length} location pages
            </p>
          )}
          {competitors.length === 0 ? (
            <Card>
              <EmptyState title="No competitors added" />
            </Card>
          ) : (
            competitors.map((c) => {
              const o = c.observations[0];
              const d = o?.data as { pagesAnalysed: number; pageTypes: Record<string, number>; avgServicePageWords: number | null; schemaTypes: string[]; hasBlog: boolean; sitemapUrlCount: number; servicePages: { url: string; title: string | null; words: number }[] } | undefined;
              return (
                <Card key={c.id}>
                  <CardHeader title={c.businessName ? `${c.businessName} (${c.domain})` : c.domain} description={o ? `${o.dataSource} · ${formatDate(o.observedAt, true)}` : "Not observed yet"} action={<CompetitorButtons prospectId={id} competitorId={c.id} domain={c.domain} />} />
                  {d && (
                    <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
                      <dl className="grid grid-cols-2 gap-3">
                        <div>
                          <dt className="text-xs text-muted">Pages observed</dt>
                          <dd className="font-medium">{d.pagesAnalysed}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">URLs in sitemap</dt>
                          <dd className="font-medium">{d.sitemapUrlCount}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Service / tour pages</dt>
                          <dd className="font-medium">{(d.pageTypes.SERVICE ?? 0) + (d.pageTypes.PRODUCT ?? 0)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Location pages</dt>
                          <dd className="font-medium">{d.pageTypes.LOCATION ?? 0}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Avg. words on those pages</dt>
                          <dd className="font-medium">{d.avgServicePageWords ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Blog articles found</dt>
                          <dd className="font-medium">{d.hasBlog ? "Yes" : "No"}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-xs text-muted">Structured data types</dt>
                          <dd>{d.schemaTypes.join(", ") || "None found"}</dd>
                        </div>
                      </dl>
                      <div>
                        <p className="text-xs text-muted">Service / tour pages seen</p>
                        <ul className="mt-1 space-y-1">
                          {d.servicePages.slice(0, 8).map((s) => (
                            <li key={s.url} className="truncate">
                              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-primary">
                                {s.title ?? s.url}
                              </a>{" "}
                              <span className="text-xs text-muted">({s.words} words)</span>
                            </li>
                          ))}
                          {d.servicePages.length === 0 && <li className="text-muted">None identified within the page limit</li>}
                        </ul>
                      </div>
                      <p className="text-xs text-muted md:col-span-2">Observed directly from public pages within a small page limit. Keyword overlap and backlink comparisons need imported data.</p>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === "performance" && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="PageSpeed Insights" description="Google's own test. Lab = simulated load on a mid-range phone; field = real Chrome users over 28 days (only for sites with enough traffic)." />
            <div className="p-5">
              <PageSpeedButtons prospectId={id} />
              <p className="mt-2 text-xs text-muted">Results that indicate a problem are added as findings to the latest audit (field data as confirmed, lab-only as “needs verification”).</p>
            </div>
          </Card>
          {tests.length === 0 ? (
            <Card>
              <EmptyState title="No performance tests yet" />
            </Card>
          ) : (
            tests.map((t) => {
              const lab = t.lab as LabMetrics | null;
              const field = t.field as FieldMetrics | null;
              return (
                <Card key={t.id}>
                  <CardHeader title={`${t.strategy === "MOBILE" ? "Mobile" : "Desktop"} · ${formatDate(t.testedAt, true)}`} description={t.url} />
                  {t.error ? (
                    <p className="p-5 text-sm text-danger">{t.error}</p>
                  ) : (
                    <div className="grid gap-6 p-5 text-sm md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">Lab test (simulated)</p>
                        <p className="mt-1 text-3xl font-semibold tabular-nums">{lab?.performanceScore ?? "—"}<span className="text-base text-muted">/100</span></p>
                        <p className="mt-1 text-muted">LCP {ms(lab?.lcpMs)} · TBT {ms(lab?.tbtMs)} · CLS {lab?.cls ?? "—"} · FCP {ms(lab?.fcpMs)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">Real users (Chrome UX Report{t.fieldScope === "ORIGIN" ? ", whole site" : t.fieldScope === "URL" ? ", this page" : ""})</p>
                        {field ? (
                          <ul className="mt-2 space-y-1">
                            {(
                              [
                                ["LCP", field.lcp, (v: number) => ms(v)],
                                ["INP", field.inp, (v: number) => ms(v)],
                                ["CLS", field.cls, (v: number) => (v / 100).toFixed(2)],
                              ] as const
                            ).map(([label, m, f]) =>
                              m ? (
                                <li key={label} className="flex items-center justify-between">
                                  <span>{label}</span>
                                  <span className="flex items-center gap-2 tabular-nums">
                                    {f(m.percentile)} <Badge tone={CAT_TONE[m.category] ?? "neutral"}>{m.category === "AVERAGE" ? "needs improvement" : m.category.toLowerCase()}</Badge>
                                  </span>
                                </li>
                              ) : null,
                            )}
                          </ul>
                        ) : (
                          <p className="mt-1 text-muted">Not available — Google has too little real-user data for this site.</p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

type DomainRow = { key: string; competitorId: string | null; label: string; domain: string; check?: { data: unknown; checkedAt: Date } };

const SIGNAL_TONE: Record<DomainOverview["signals"][number]["tone"], BadgeTone> = { good: "success", warning: "warning", info: "info" };
const yearsSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / (365.25 * 86_400_000));

/** One cell per source: the value, or "unavailable" with the reason on hover — never a guess. */
function SourceCell<T>({ part, render }: { part: ({ ok: true } & T) | { ok: false; error: string } | undefined; render: (v: T) => React.ReactNode }) {
  if (!part) return <span className="text-muted">—</span>;
  if (!part.ok) return <span className="text-xs text-muted" title={part.error}>unavailable</span>;
  return <>{render(part)}</>;
}

function DomainOverviewTab({ prospectId, rows }: { prospectId: string; rows: DomainRow[] }) {
  const own = rows[0].check?.data as DomainOverview | undefined;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`What we know about ${rows[0].domain}`}
          description="Free public sources only — no paid tools. Useful talking points for the first call and the proposal."
          action={<DomainCheckButton prospectId={prospectId} competitorId={null} label={own ? "Check again" : "Check domain"} />}
        />
        {own ? (
          <ul className="space-y-2 p-5 text-sm">
            {own.signals.map((s) => (
              <li key={s.text} className="flex items-start gap-2">
                <Badge tone={SIGNAL_TONE[s.tone]} className="mt-0.5 shrink-0">
                  {s.tone === "good" ? "good" : s.tone === "warning" ? "fix" : "note"}
                </Badge>
                <span>{s.text}</span>
              </li>
            ))}
            {own.signals.length === 0 && <li className="text-muted">No notable signals.</li>}
          </ul>
        ) : (
          <p className="p-5 text-sm text-muted">Not checked yet. The check takes about 10–40 seconds (the first one downloads the Tranco ranking list).</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Compare with competitors" description="Add competitors on the Competitors tab, then check each domain here." />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Domain</th>
                <th scope="col" className="px-4 py-3 font-medium">Age</th>
                <th scope="col" className="px-4 py-3 font-medium">First archived</th>
                <th scope="col" className="px-4 py-3 font-medium">World rank</th>
                <th scope="col" className="px-4 py-3 font-medium">Website</th>
                <th scope="col" className="px-4 py-3 font-medium">Tracking</th>
                <th scope="col" className="px-4 py-3 font-medium">Email security</th>
                <th scope="col" className="px-4 py-3 font-medium">SSL</th>
                <th scope="col" className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const o = r.check?.data as DomainOverview | undefined;
                return (
                  <tr key={r.key} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.label}</p>
                      <p className="text-xs text-muted">
                        {r.domain}
                        {r.competitorId === null && " · your prospect"}
                      </p>
                      {r.check && <p className="text-xs text-muted">checked {formatDate(r.check.checkedAt, true)}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <SourceCell part={o?.registration} render={(v) => (v.registeredAt ? `${yearsSince(v.registeredAt)} yr · since ${formatDate(v.registeredAt)}` : "—")} />
                    </td>
                    <td className="px-4 py-3">
                      <SourceCell part={o?.history} render={(v) => (v.firstCapture ? formatDate(v.firstCapture) : "Never archived")} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <SourceCell part={o?.popularity} render={(v) => (v.rank ? `#${v.rank.toLocaleString("en-US")}` : "Not in top 1M")} />
                    </td>
                    <td className="px-4 py-3">
                      <SourceCell part={o?.tech} render={(v) => [v.cms, ...v.other].filter(Boolean).join(", ") || "—"} />
                    </td>
                    <td className="px-4 py-3">
                      <SourceCell part={o?.tech} render={(v) => (v.analytics.length ? v.analytics.join(", ") : <Badge tone="warning">none found</Badge>)} />
                    </td>
                    <td className="px-4 py-3">
                      <SourceCell
                        part={o?.email}
                        render={(v) =>
                          !v.mx ? (
                            <span className="text-muted">No email on domain</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              <Badge tone={v.spf ? "success" : "warning"}>SPF {v.spf ? "✓" : "✗"}</Badge>
                              <Badge tone={v.dmarc ? "success" : "warning"}>DMARC {v.dmarc ? "✓" : "✗"}</Badge>
                            </span>
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <SourceCell part={o?.ssl} render={(v) => <Badge tone={v.daysLeft < 21 ? "warning" : "success"}>{v.daysLeft < 0 ? "expired" : `${v.daysLeft} days left`}</Badge>} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DomainCheckButton prospectId={prospectId} competitorId={r.competitorId} label={r.check ? "Recheck" : "Check"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-5 py-3 text-xs text-muted">
          Sources: {Object.values(DOMAIN_SOURCES).join(" · ")}. Domain Authority / Domain Rating and traffic estimates come from paid link databases (Moz, Ahrefs, Semrush) and are not shown here. Import a backlink CSV on the Backlinks tab if you have one.
        </p>
      </Card>
    </div>
  );
}
