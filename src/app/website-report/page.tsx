import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, Rocket, Search, Sparkles, Target, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isMonthKey, monthKey, monthLabel, shiftMonth } from "@/lib/client-work";
import { getWebsite } from "@/lib/websites";
import { GscError, monthReport, type GscTotals } from "@/lib/search-console";
import { CHANGE_LABELS, monthChanges, type ChangeKind } from "@/lib/site-changes";
import { WORK_CATEGORIES, monthWork, type WorkCategory } from "@/lib/work-log";
import { insights, type KeywordMove } from "@/lib/report-insights";
import { PrintButton } from "../work-report/print-button";
import { readReportLink } from "@/lib/report-delivery";

export const metadata: Metadata = { title: "Monthly SEO report", robots: { index: false } };

const n = (v: number) => Math.round(v).toLocaleString();
const pct = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

function Change({ now, before, invert, unit = "%" }: { now: number; before: number; invert?: boolean; unit?: "%" | "pos" }) {
  if (unit === "pos") {
    if (!before || !now) return null;
    const d = before - now;
    if (Math.abs(d) < 0.05) return <span className="text-[#64748b]">no change</span>;
    return <span className={d > 0 ? "text-[#16a34a]" : "text-[#dc2626]"}>{`${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} ${d > 0 ? "better" : "lower"}`}</span>;
  }
  const p = pct(now, before);
  if (p === null) return now ? <span className="text-[#16a34a]">new</span> : null;
  const good = invert ? p < 0 : p > 0;
  return <span className={Math.abs(p) < 0.5 ? "text-[#64748b]" : good ? "text-[#16a34a]" : "text-[#dc2626]"}>{`${p > 0 ? "+" : ""}${p.toFixed(0)}% vs last month`}</span>;
}

/** One page of the report: a "slide" on screen, a printed page on paper. */
function Slide({ title, kicker, icon, children, brand }: { title: string; kicker?: string; icon?: React.ReactNode; children: React.ReactNode; brand: string }) {
  return (
    <section className="mx-auto mb-6 max-w-4xl overflow-hidden rounded-2xl bg-white px-10 py-9 text-[#0f172a] shadow-xl print:mb-0 print:max-w-none print:break-after-page print:rounded-none print:shadow-none">
      <div className="mb-5 flex items-center gap-3">
        {icon && (
          <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: brand }}>
            {icon}
          </span>
        )}
        <div>
          {kicker && <p className="text-[11px] font-semibold tracking-[0.18em] text-[#64748b] uppercase">{kicker}</p>}
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function MoveTable({ rows, mode }: { rows: KeywordMove[]; mode: "clicks" | "position" | "opportunity" }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-[#64748b]">
          <th className="py-1.5 font-medium">Search</th>
          <th className="py-1.5 text-right font-medium">{mode === "opportunity" ? "Seen" : "Clicks"}</th>
          <th className="py-1.5 text-right font-medium">Position</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-[#f1f5f9]">
            <td className="py-1.5 pr-3">{r.key}</td>
            <td className="py-1.5 text-right tabular-nums">
              {mode === "opportunity" ? (
                `${n(r.impressions)}×`
              ) : (
                <>
                  {n(r.clicks)} <span className="text-xs text-[#94a3b8]">(was {n(r.previousClicks)})</span>
                </>
              )}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {r.position.toFixed(1)}
              {r.previousPosition != null && <span className="text-xs text-[#94a3b8]"> (was {r.previousPosition.toFixed(1)})</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Clicks per day this month, with last month dashed underneath. */
function Trend({ series, previous, brand }: { series: { date: string; clicks: number }[]; previous: { date: string; clicks: number }[]; brand: string }) {
  if (series.length < 2) return null;
  const W = 800;
  const H = 180;
  const max = Math.max(1, ...series.map((s) => s.clicks), ...previous.map((s) => s.clicks));
  const line = (pts: { clicks: number }[]) => pts.map((p, i) => `${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - 10 - (p.clicks / max) * (H - 24)).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" preserveAspectRatio="none" role="img" aria-label="Clicks per day">
        {previous.length > 1 && <polyline points={line(previous)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
        <polyline points={`0,${H} ${line(series)} ${W},${H}`} fill={brand} fillOpacity="0.08" stroke="none" />
        <polyline points={line(series)} fill="none" stroke={brand} strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-[#94a3b8]">
        <span>{series[0].date}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-4" style={{ background: brand }} /> this month
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-[#94a3b8]" /> last month
          </span>
        </span>
        <span>{series[series.length - 1].date}</span>
      </div>
    </div>
  );
}

/**
 * The monthly SEO report of one website, laid out as a presentation: results, wins, the work done,
 * top searches and pages, opportunities and next month's plan. Everything comes from Search Console,
 * the work log and changes found on the live site — nothing is made up.
 */
export default async function WebsiteReportPage({ searchParams }: { searchParams: Promise<{ site?: string; month?: string; k?: string }> }) {
  const sp = await searchParams;
  // A signed print link (for the emailed PDF) opens exactly one report; otherwise a login is needed.
  const link = sp.k ? readReportLink(sp.k) : null;
  if (sp.k && (!link || link.websiteId !== sp.site || link.month !== sp.month)) notFound();
  const workspaceId = link ? link.workspaceId : (await requireSession()).workspace.id;
  const session = { workspace: { id: workspaceId } };
  // The last complete month by default: the current month has little or no Search Console data yet.
  const month = isMonthKey(sp.month) ? sp.month : shiftMonth(monthKey(), -1);
  if (!sp.site) notFound();
  const w = await getWebsite(session.workspace.id, sp.site);
  if (!w) notFound();
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id }, select: { companyName: true, consultantName: true, brandColor: true } });
  const brand = settings?.brandColor || "#4f46e5";
  const [changes, work] = await Promise.all([monthChanges(session.workspace.id, { websiteId: w.id }, month), monthWork(session.workspace.id, w.id, month)]);
  let gsc: Awaited<ReturnType<typeof monthReport>> | null = null;
  let gscError: string | null = null;
  if (w.gscSiteUrl) {
    try {
      gsc = await monthReport(session.workspace.id, w.id, month);
    } catch (e) {
      gscError = e instanceof GscError ? e.message : "Search Console could not be reached.";
    }
  }
  const t: GscTotals | null = gsc?.queries.totals ?? null;
  const p: GscTotals | null = gsc?.queries.previousTotals ?? null;
  const found = gsc ? insights(gsc.queries.rows, gsc.pages.rows) : null;
  const hasData = !!t && t.impressions > 0;

  // Work found on the live site by the weekly check, grouped the way an SEO would report it.
  const detected = {
    published: changes.filter((c) => c.kind === "NEW_PAGE"),
    content: changes.filter((c) => c.kind === "CONTENT"),
    onpage: changes.filter((c) => c.kind === "TITLE" || c.kind === "META_DESCRIPTION" || c.kind === "H1"),
    technical: changes.filter((c) => c.kind === "CANONICAL" || c.kind === "INDEXING" || c.kind === "STATUS" || c.kind === "REMOVED_PAGE"),
  };
  const byCategory = work.reduce<Record<string, typeof work>>((a, e) => ((a[e.category] ??= []).push(e), a), {});
  const workItems = work.reduce((s, e) => s + e.count, 0) + changes.length;
  const clicksChange = t && p ? pct(t.clicks, p.clicks) : null;
  const headline = !hasData
    ? `${monthLabel(month)} at a glance`
    : clicksChange != null && clicksChange >= 0
      ? `${n(t!.clicks)} visitors from Google — ${clicksChange.toFixed(0)}% more than last month`
      : `${n(t!.clicks)} visitors from Google and ${n(t!.impressions)} appearances in search`;

  return (
    <div className="theme-light min-h-screen bg-[#e9edf3] py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <Link href={`/websites/${w.id}`} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0f172a]">
          <ArrowLeft className="h-4 w-4" /> {w.name}
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/website-report?site=${w.id}&month=${shiftMonth(month, -1)}`} className="inline-flex items-center rounded-lg px-2 py-1 text-[#475569] hover:bg-white">
            <ChevronLeft className="h-4 w-4" /> {monthLabel(shiftMonth(month, -1))}
          </Link>
          <span className="font-semibold text-[#0f172a]">{monthLabel(month)}</span>
          {month < monthKey() && (
            <Link href={`/website-report?site=${w.id}&month=${shiftMonth(month, 1)}`} className="inline-flex items-center rounded-lg px-2 py-1 text-[#475569] hover:bg-white">
              {monthLabel(shiftMonth(month, 1))} <ChevronRight className="h-4 w-4" />
            </Link>
          )}
          <PrintButton />
        </div>
      </div>

      {/* Cover */}
      <section className="mx-auto mb-6 max-w-4xl overflow-hidden rounded-2xl text-white shadow-xl print:mb-0 print:flex print:min-h-[260mm] print:max-w-none print:break-after-page print:flex-col print:justify-between print:rounded-none print:shadow-none" style={{ background: `radial-gradient(120% 120% at 100% 0%, ${brand}cc, transparent 55%), linear-gradient(150deg, #0b1130, ${brand})` }}>
        <div className="px-10 pt-12 pb-10">
          <p className="text-xs font-semibold tracking-[0.25em] uppercase opacity-80">Monthly SEO report · {monthLabel(month)}</p>
          <h1 className="mt-4 text-4xl leading-tight font-extrabold tracking-tight">{w.name}</h1>
          <p className="mt-1 text-lg opacity-85">{w.domain}</p>
          <p className="mt-8 max-w-2xl text-2xl leading-snug font-semibold">{headline}</p>
          {hasData && p && (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Clicks", n(t!.clicks), pct(t!.clicks, p.clicks)],
                ["Impressions", n(t!.impressions), pct(t!.impressions, p.impressions)],
                ["Avg. position", t!.position.toFixed(1), null],
                ["Click-through rate", `${(t!.ctr * 100).toFixed(1)}%`, null],
              ].map(([label, value, change]) => (
                <div key={label as string} className="rounded-xl bg-white/12 p-4 ring-1 ring-white/20 backdrop-blur">
                  <p className="text-xs opacity-75">{label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
                  {typeof change === "number" && <p className="text-xs opacity-85">{`${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs ${monthLabel(shiftMonth(month, -1))}`}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-10 pb-8 text-sm opacity-80">
          <span>Prepared by {[settings?.consultantName, settings?.companyName].filter(Boolean).join(" · ") || "your SEO team"}</span>
          <span>{workItems ? `${workItems} pieces of work this month` : ""}</span>
        </div>
      </section>

      {/* Results */}
      <Slide title="Results on Google" kicker={`${monthLabel(month)} compared with ${monthLabel(shiftMonth(month, -1))}`} icon={<TrendingUp className="h-5 w-5" />} brand={brand}>
        {!w.gscSiteUrl ? (
          <p className="text-[#64748b]">Search Console is not linked for this website yet — link it on the website page to add the results.</p>
        ) : gscError ? (
          <p className="text-[#b45309]">{gscError}</p>
        ) : !hasData ? (
          <p className="text-[#64748b]">Google has no Search Console data for {monthLabel(month)} yet. Search Console reports with a delay of about two days.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[#e2e8f0] p-4">
                <p className="text-xs text-[#64748b]">Clicks from Google</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: brand }}>
                  {n(t!.clicks)}
                </p>
                <p className="text-xs">
                  <Change now={t!.clicks} before={p!.clicks} />
                </p>
              </div>
              <div className="rounded-xl border border-[#e2e8f0] p-4">
                <p className="text-xs text-[#64748b]">Times shown on Google</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: brand }}>
                  {n(t!.impressions)}
                </p>
                <p className="text-xs">
                  <Change now={t!.impressions} before={p!.impressions} />
                </p>
              </div>
              <div className="rounded-xl border border-[#e2e8f0] p-4">
                <p className="text-xs text-[#64748b]">Average position</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: brand }}>
                  {t!.position.toFixed(1)}
                </p>
                <p className="text-xs">
                  <Change now={t!.position} before={p!.position} unit="pos" />
                </p>
              </div>
              <div className="rounded-xl border border-[#e2e8f0] p-4">
                <p className="text-xs text-[#64748b]">Click-through rate</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: brand }}>
                  {(t!.ctr * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-[#64748b]">was {(p!.ctr * 100).toFixed(1)}%</p>
              </div>
            </div>
            <div className="mt-6">
              <Trend series={gsc!.queries.series} previous={gsc!.queries.previousSeries} brand={brand} />
            </div>
            {found && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#f8fafc] p-4">
                  <p className="text-3xl font-bold tabular-nums">{found.top3}</p>
                  <p className="text-sm text-[#475569]">searches in the top 3 results</p>
                </div>
                <div className="rounded-xl bg-[#f8fafc] p-4">
                  <p className="text-3xl font-bold tabular-nums">{found.top10}</p>
                  <p className="text-sm text-[#475569]">searches on page one {found.previousTop10 ? <span className="text-[#94a3b8]">(was {found.previousTop10})</span> : null}</p>
                </div>
                <div className="rounded-xl bg-[#f8fafc] p-4">
                  <p className="text-3xl font-bold tabular-nums">{found.newKeywords}</p>
                  <p className="text-sm text-[#475569]">new searches the site now appears for</p>
                </div>
              </div>
            )}
          </>
        )}
      </Slide>

      {/* Wins */}
      {found && (found.gained.length > 0 || found.climbed.length > 0) && (
        <Slide title="Highlights of the month" kicker="What improved" icon={<Sparkles className="h-5 w-5" />} brand={brand}>
          <div className="grid gap-6 md:grid-cols-2">
            {found.gained.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
                  <ArrowUpRight className="h-4 w-4 text-[#16a34a]" /> More clicks
                </h3>
                <MoveTable rows={found.gained} mode="clicks" />
              </div>
            )}
            {found.climbed.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
                  <TrendingUp className="h-4 w-4 text-[#16a34a]" /> Better rankings
                </h3>
                <MoveTable rows={found.climbed} mode="position" />
              </div>
            )}
          </div>
        </Slide>
      )}

      {/* Work done */}
      <Slide title="Work completed this month" kicker="What we did" icon={<CheckCircle2 className="h-5 w-5" />} brand={brand}>
        {work.length === 0 && changes.length === 0 ? (
          <p className="text-[#64748b]">No work was logged for {monthLabel(month)} and no changes were found on the live website.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(byCategory).map(([cat, entries]) => (
              <div key={cat} className="rounded-xl border border-[#e2e8f0] p-4 break-inside-avoid">
                <p className="flex items-center justify-between font-semibold">
                  {WORK_CATEGORIES[cat as WorkCategory]?.label ?? cat}
                  <span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: brand }}>
                    {entries.reduce((s, e) => s + e.count, 0)}
                  </span>
                </p>
                <ul className="mt-2 space-y-1 text-sm text-[#334155]">
                  {entries.map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" />
                      <span>
                        {e.count > 1 ? `${e.count} × ` : ""}
                        {e.title}
                        {e.url && <span className="block truncate text-xs text-[#94a3b8]">{path(e.url)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {(
              [
                ["New pages and articles published", detected.published],
                ["Content updated", detected.content],
                ["Titles, descriptions and headings improved", detected.onpage],
                ["Technical changes", detected.technical],
              ] as const
            ).map(([label, list]) =>
              list.length ? (
                <div key={label} className="rounded-xl border border-dashed border-[#cbd5e1] p-4 break-inside-avoid">
                  <p className="flex items-center justify-between font-semibold">
                    {label}
                    <span className="rounded-full bg-[#e2e8f0] px-2 py-0.5 text-xs">{list.length}</span>
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-[#334155]">
                    {list.slice(0, 6).map((c) => (
                      <li key={c.id} className="truncate">
                        {path(c.url)} {c.after && c.kind !== "CONTENT" ? <span className="text-[#64748b]">— {c.after}</span> : c.kind === "CONTENT" ? <span className="text-[#64748b]">— {c.before} → {c.after}</span> : null}
                      </li>
                    ))}
                    {list.length > 6 && <li className="text-xs text-[#94a3b8]">…and {list.length - 6} more</li>}
                  </ul>
                  <p className="mt-2 text-[11px] text-[#94a3b8]">Found on the live website</p>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Slide>

      {/* Top searches and pages */}
      {hasData && (
        <Slide title="Top searches and pages" kicker="Where visitors come from" icon={<Search className="h-5 w-5" />} brand={brand}>
          <div className="grid gap-6 md:grid-cols-2">
            {[
              { title: "Top searches", rows: gsc!.queries.rows, page: false },
              { title: "Top pages", rows: gsc!.pages.rows, page: true },
            ].map((b) => (
              <div key={b.title}>
                <h3 className="mb-2 font-semibold">{b.title}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#64748b]">
                      <th className="py-1.5 font-medium">{b.page ? "Page" : "Search"}</th>
                      <th className="py-1.5 text-right font-medium">Clicks</th>
                      <th className="py-1.5 text-right font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.slice(0, 10).map((r) => {
                      const d = r.clicks - (r.previous?.clicks ?? 0);
                      return (
                        <tr key={r.key} className="border-t border-[#f1f5f9]">
                          <td className="max-w-[16rem] truncate py-1.5 pr-3">{b.page ? path(r.key) : r.key}</td>
                          <td className="py-1.5 text-right tabular-nums">{n(r.clicks)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${!r.previous ? "text-[#16a34a]" : d > 0 ? "text-[#16a34a]" : d < 0 ? "text-[#dc2626]" : "text-[#94a3b8]"}`}>{!r.previous ? "new" : `${d > 0 ? "+" : ""}${n(d)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Slide>
      )}

      {/* Opportunities */}
      {found && (found.nearPageOne.length > 0 || found.lowCtr.length > 0) && (
        <Slide title="Opportunities" kicker="The quickest wins next" icon={<Target className="h-5 w-5" />} brand={brand}>
          <div className="grid gap-6 md:grid-cols-2">
            {found.nearPageOne.length > 0 && (
              <div>
                <h3 className="font-semibold">Close to page one</h3>
                <p className="mb-2 text-xs text-[#64748b]">Already on page two — a push here brings new visitors fastest.</p>
                <MoveTable rows={found.nearPageOne} mode="opportunity" />
              </div>
            )}
            {found.lowCtr.length > 0 && (
              <div>
                <h3 className="font-semibold">Seen often, clicked rarely</h3>
                <p className="mb-2 text-xs text-[#64748b]">High on Google but under 2% click — better titles and descriptions win these clicks.</p>
                <MoveTable rows={found.lowCtr} mode="opportunity" />
              </div>
            )}
          </div>
          {(found.lost.length > 0 || found.pagesDown.length > 0) && (
            <div className="mt-6 rounded-xl bg-[#fff7ed] p-4">
              <h3 className="flex items-center gap-1.5 font-semibold text-[#9a3412]">
                <ArrowDownRight className="h-4 w-4" /> Watch list
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-[#7c2d12]">
                {found.lost.map((r) => (
                  <li key={r.key}>
                    “{r.key}” — {n(r.clicks)} clicks (was {n(r.previousClicks)})
                  </li>
                ))}
                {found.pagesDown.map((r) => (
                  <li key={r.key}>
                    {path(r.key)} — {n(r.clicks)} clicks (was {n(r.previousClicks)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Slide>
      )}

      {/* Plan */}
      <Slide title={`Plan for ${monthLabel(shiftMonth(month, 1))}`} kicker="Next steps" icon={<Rocket className="h-5 w-5" />} brand={brand}>
        <ol className="space-y-3">
          {(found?.plan ?? ["Link Search Console to plan next month from the data", "Keep publishing helpful content and strengthen internal links between related pages"]).map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: brand }}>
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 flex items-start gap-2 rounded-xl bg-[#f8fafc] p-4 text-sm text-[#475569]">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" style={{ color: brand }} />
          Every number in this report comes from Google Search Console for {w.domain}; the work listed was logged by our team or found on the live website.
        </p>
      </Slide>

      {/* Appendix */}
      {changes.length > 0 && (
        <Slide title="Appendix: all changes found on the website" kicker={monthLabel(month)} brand={brand}>
          <ul className="space-y-1.5 text-sm">
            {changes.slice(0, 60).map((c) => (
              <li key={c.id} className="flex gap-2 border-b border-[#f1f5f9] pb-1.5">
                <span className="w-40 shrink-0 font-medium">{CHANGE_LABELS[c.kind as ChangeKind] ?? c.kind}</span>
                <span className="min-w-0 flex-1 truncate text-[#475569]">
                  {path(c.url)}
                  {c.after ? ` — ${c.before ? `${c.before} → ` : ""}${c.after}` : ""}
                </span>
                <span className="shrink-0 text-xs text-[#94a3b8]">{c.detectedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </Slide>
      )}
    </div>
  );
}
