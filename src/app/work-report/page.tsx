import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isMonthKey, monthKey, monthLabel, workReport } from "@/lib/client-work";
import { progressReport } from "@/lib/progress";
import { PrintButton } from "./print-button";

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

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

export const metadata: Metadata = { title: "Monthly work report", robots: { index: false } };

/** One client's month on one printable page: what was done, and what continues next month. */
export default async function WorkReportPage({ searchParams }: { searchParams: Promise<{ client?: string; month?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : monthKey();
  if (!sp.client) notFound();
  const report = await workReport(session.workspace.id, sp.client, month);
  if (!report) notFound();
  const progress = await progressReport(session.workspace.id, report.client.id);
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id }, select: { companyName: true, consultantName: true, brandColor: true } });
  const brand = settings?.brandColor || "#4f46e5";
  const total = report.done.length + report.open.length;
  const pct = total ? Math.round((report.done.length / total) * 100) : 0;

  return (
    <div className="theme-light min-h-screen bg-[#eef1f6] py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href={`/work?month=${month}&client=${report.client.id}`} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0f172a]">
          <ArrowLeft className="h-4 w-4" /> Back to the board
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white text-[#0f172a] shadow-xl print:rounded-none print:shadow-none">
        <header className="px-10 py-9 text-white" style={{ background: `linear-gradient(135deg, ${brand}, #0b1130)` }}>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-80">Monthly work report</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{report.client.businessName}</h1>
          <p className="mt-1 opacity-85">
            {monthLabel(month)}
            {settings?.companyName ? ` · prepared by ${settings.companyName}` : ""}
          </p>
          <div className="mt-6 flex items-center gap-4">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-semibold tabular-nums">
              {report.done.length} of {total} tasks done
            </span>
          </div>
        </header>

        {progress && (
          <section className="border-b border-[#e2e8f0] px-10 py-8 break-inside-avoid">
            <h2 className="text-lg font-bold">Your website: before our work and now</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              First audit {fmt(progress.before.date)} · latest check {fmt(progress.now.date)}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Problems fixed" value={String(progress.fixed.length)} tone="#16a34a" />
              <Stat label="Still to fix" value={String(progress.remaining.length)} tone="#b45309" />
              {progress.speed.before != null && progress.speed.now != null && <Stat label="Mobile speed score" value={`${Math.round(progress.speed.before)} → ${Math.round(progress.speed.now)}`} tone={brand} />}
              {progress.reviews.before && progress.reviews.now && (progress.reviews.now.count ?? 0) > 0 && (
                <Stat label="Google reviews" value={`${progress.reviews.before.count ?? 0} → ${progress.reviews.now.count}`} hint={progress.reviews.now.rating ? `★ ${progress.reviews.now.rating.toFixed(1)}` : undefined} tone={brand} />
              )}
            </div>
            <table className="mt-5 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#64748b]">
                  <th className="py-1 font-medium">Issue level</th>
                  <th className="py-1 text-right font-medium">Before</th>
                  <th className="py-1 text-right font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {progress.severity.map((s) => (
                  <tr key={s.key} className="border-t border-[#f1f5f9]">
                    <td className="py-1.5 capitalize">{s.key.toLowerCase()}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.before}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${s.now < s.before ? "text-[#16a34a]" : s.now > s.before ? "text-[#dc2626]" : ""}`}>{s.now}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {progress.fixed.length > 0 && (
              <>
                <h3 className="mt-6 text-sm font-bold">Fixed since we started</h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {progress.fixed.slice(0, 12).map((f) => (
                    <li key={f.ruleId} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" /> {f.title}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {progress.newIssues.length > 0 && (
              <p className="mt-4 text-xs text-[#64748b]">
                {progress.newIssues.length} new item{progress.newIssues.length === 1 ? "" : "s"} found in the latest check (for example after site changes) — we will review them next month.
              </p>
            )}
          </section>
        )}

        <section className="px-10 py-8">
          <h2 className="text-lg font-bold">Completed this month</h2>
          {report.done.length === 0 ? (
            <p className="mt-2 text-sm text-[#64748b]">No tasks are marked done for this month yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {report.done.map((t) => (
                <li key={t.id} className="flex gap-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 break-inside-avoid">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16a34a]" />
                  <div>
                    <p className="font-semibold">{t.title}</p>
                    {t.detail && <p className="mt-0.5 text-sm text-[#475569]">{t.detail}</p>}
                    {t.doneAt && <p className="mt-1 text-xs text-[#94a3b8]">Completed {t.doneAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {report.open.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-bold">Continuing next month</h2>
              <ul className="mt-4 space-y-2">
                {report.open.map((t) => (
                  <li key={t.id} className="flex gap-3 text-sm break-inside-avoid">
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[#94a3b8]" />
                    <span>
                      <b className="font-medium">{t.title}</b>
                      {t.status === "DOING" && <span className="ml-2 rounded bg-[#fef3c7] px-1.5 py-0.5 text-[11px] font-medium text-[#b45309]">In progress</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <footer className="border-t border-[#e2e8f0] px-10 py-5 text-xs text-[#64748b]">
          {[settings?.consultantName, settings?.companyName].filter(Boolean).join(" · ") || "Your SEO team"} · {report.client.websiteUrl}
        </footer>
      </article>
    </div>
  );
}
