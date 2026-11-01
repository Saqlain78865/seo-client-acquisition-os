import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isMonthKey, monthKey, monthLabel, shiftMonth } from "@/lib/client-work";
import { getWebsite } from "@/lib/websites";
import { GscError, monthReport, type GscTotals } from "@/lib/search-console";
import { CHANGE_LABELS, monthChanges, type ChangeKind } from "@/lib/site-changes";
import { PrintButton } from "../work-report/print-button";

export const metadata: Metadata = { title: "Website report", robots: { index: false } };

const pct = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}% vs last month` : now ? "new this month" : undefined);

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
      <p className="text-xs text-[#64748b]">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: tone }}>
        {value}
      </p>
      {hint && <p className="text-xs text-[#64748b]">{hint}</p>}
    </div>
  );
}

/** One website's month on one printable page: results on Google and the changes made to the site. */
export default async function WebsiteReportPage({ searchParams }: { searchParams: Promise<{ site?: string; month?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : monthKey();
  if (!sp.site) notFound();
  const w = await getWebsite(session.workspace.id, sp.site);
  if (!w) notFound();
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id }, select: { companyName: true, consultantName: true, brandColor: true } });
  const brand = settings?.brandColor || "#4f46e5";
  const changes = await monthChanges(session.workspace.id, { websiteId: w.id }, month);
  let results: Awaited<ReturnType<typeof monthReport>> | null = null;
  let resultsError: string | null = null;
  if (w.gscSiteUrl) {
    try {
      results = await monthReport(session.workspace.id, w.id, month);
    } catch (e) {
      resultsError = e instanceof GscError ? e.message : "Search Console could not be reached.";
    }
  }
  const t: GscTotals | null = results?.queries.totals ?? null;
  const p: GscTotals | null = results?.queries.previousTotals ?? null;
  const byKind = changes.reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});

  return (
    <div className="theme-light min-h-screen bg-[#eef1f6] py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 px-4 print:hidden">
        <Link href={`/websites/${w.id}`} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0f172a]">
          <ArrowLeft className="h-4 w-4" /> {w.name}
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/website-report?site=${w.id}&month=${shiftMonth(month, -1)}`} className="text-[#475569] hover:text-[#0f172a]">
            ← {monthLabel(shiftMonth(month, -1))}
          </Link>
          <PrintButton />
        </div>
      </div>

      <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white text-[#0f172a] shadow-xl print:rounded-none print:shadow-none">
        <header className="px-10 py-9 text-white" style={{ background: `linear-gradient(135deg, ${brand}, #0b1130)` }}>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-80">Monthly SEO report</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{w.name}</h1>
          <p className="mt-1 opacity-85">
            {w.domain} · {monthLabel(month)}
            {settings?.companyName ? ` · prepared by ${settings.companyName}` : ""}
          </p>
        </header>

        <section className="border-b border-[#e2e8f0] px-10 py-8 break-inside-avoid">
          <h2 className="text-lg font-bold">Results on Google</h2>
          {!w.gscSiteUrl ? (
            <p className="mt-2 text-sm text-[#64748b]">Search Console is not linked for this website yet.</p>
          ) : resultsError ? (
            <p className="mt-2 text-sm text-[#b45309]">{resultsError}</p>
          ) : t && p ? (
            <>
              <p className="mt-1 text-sm text-[#64748b]">From Google Search Console · {monthLabel(month)} compared with {monthLabel(shiftMonth(month, -1))}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Clicks from Google" value={t.clicks.toLocaleString()} hint={pct(t.clicks, p.clicks)} tone={brand} />
                <Stat label="Times shown on Google" value={t.impressions.toLocaleString()} hint={pct(t.impressions, p.impressions)} tone={brand} />
                <Stat label="Average position" value={t.position ? t.position.toFixed(1) : "—"} hint={p.position ? `was ${p.position.toFixed(1)}` : undefined} tone={brand} />
                <Stat label="Click-through rate" value={`${(t.ctr * 100).toFixed(1)}%`} hint={p.impressions ? `was ${(p.ctr * 100).toFixed(1)}%` : undefined} tone={brand} />
              </div>
              {results!.queries.series.length > 1 && (
                <div className="mt-5 flex h-20 items-end gap-px" aria-label="Clicks per day">
                  {results!.queries.series.map((d) => (
                    <span key={d.date} title={`${d.date}: ${d.clicks} clicks`} className="flex-1 rounded-t" style={{ background: brand, opacity: 0.8, height: `${Math.max(3, (d.clicks / Math.max(1, ...results!.queries.series.map((x) => x.clicks))) * 100)}%` }} />
                  ))}
                </div>
              )}
              {[
                { title: "Top searches", rows: results!.queries.rows, page: false },
                { title: "Top pages", rows: results!.pages.rows, page: true },
              ].map((block) =>
                block.rows.length ? (
                  <div key={block.title} className="break-inside-avoid">
                    <h3 className="mt-6 text-sm font-bold">{block.title}</h3>
                    <table className="mt-2 w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-[#64748b]">
                          <th className="py-1 font-medium">{block.page ? "Page" : "Search"}</th>
                          <th className="py-1 text-right font-medium">Clicks</th>
                          <th className="py-1 text-right font-medium">Position</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.slice(0, 10).map((r) => (
                          <tr key={r.key} className="border-t border-[#f1f5f9]">
                            <td className="max-w-xs truncate py-1.5 pr-3">{block.page ? r.key.replace(/^https?:\/\/[^/]+/, "") || "/" : r.key}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {Math.round(r.clicks)} <span className="text-xs text-[#94a3b8]">{r.previous ? `(was ${Math.round(r.previous.clicks)})` : "(new)"}</span>
                            </td>
                            <td className={`py-1.5 text-right tabular-nums ${r.previous && r.position < r.previous.position - 0.5 ? "text-[#16a34a]" : ""}`}>
                              {r.position.toFixed(1)}
                              {r.previous ? <span className="text-xs text-[#94a3b8]"> (was {r.previous.position.toFixed(1)})</span> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null,
              )}
            </>
          ) : null}
        </section>

        <section className="px-10 py-8">
          <h2 className="text-lg font-bold">Changes made to the website</h2>
          {changes.length === 0 ? (
            <p className="mt-2 text-sm text-[#64748b]">No changes were found on the live website this month.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-[#64748b]">
                {Object.entries(byKind)
                  .map(([k, n]) => `${n} × ${(CHANGE_LABELS[k as ChangeKind] ?? k).toLowerCase()}`)
                  .join(" · ")}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {changes.slice(0, 40).map((c) => (
                  <li key={c.id} className="rounded-lg border border-[#e2e8f0] px-3 py-2 break-inside-avoid">
                    <p>
                      <b className="font-semibold">{CHANGE_LABELS[c.kind as ChangeKind] ?? c.kind}</b> <span className="text-xs text-[#94a3b8]">· {c.detectedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                    </p>
                    <p className="truncate text-xs text-[#64748b]">{c.url.replace(/^https?:\/\//, "")}</p>
                    {c.after && (
                      <p className="mt-0.5 text-xs text-[#15803d]">
                        {c.before ? `${c.before} → ` : ""}
                        {c.after}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <footer className="border-t border-[#e2e8f0] px-10 py-5 text-xs text-[#64748b]">
          {[settings?.consultantName, settings?.companyName].filter(Boolean).join(" · ") || "Your SEO team"} · {w.url}
        </footer>
      </article>
    </div>
  );
}
