import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, ExternalLink, FileText, Info, Loader2, Send, Sparkles, XCircle } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { AUDIT_STAGES } from "@/lib/audit/stages";
import { CATEGORIES, SEVERITIES, SEVERITY_LABELS } from "@/lib/audit/types";
import type { BusinessProfile } from "@/lib/audit/business";
import { PAGE_TYPE_LABELS, type PageType } from "@/lib/crawler/classify";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass, tabBarClass, tabClass } from "@/components/ui";
import { AuditStatusBadge, EvidenceBadge, SeverityBadge } from "../status";
import { updateFindingAction } from "../actions";
import { AutoRefresh, RetryButton } from "./client-bits";
import { createProposalAction } from "../../proposals/actions";

export const metadata: Metadata = { title: "Audit report" };

const completedRecently = (at: Date | null) => !!at && Date.now() - at.getTime() < 120_000;

const STAGE_ICON = {
  PENDING: <CircleDashed className="h-4 w-4 text-muted" aria-hidden />,
  RUNNING: <Loader2 className="h-4 w-4 animate-spin text-info" aria-hidden />,
  COMPLETED: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />,
  PARTIAL: <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />,
  SKIPPED: <CircleSlash className="h-4 w-4 text-muted" aria-hidden />,
  FAILED: <XCircle className="h-4 w-4 text-danger" aria-hidden />,
} as const;

type Analysis = {
  business?: BusinessProfile;
  severities?: Record<string, number>;
  summarySource?: string;
  scope?: { pagesAttempted: number; pagesAnalysed: number; pageLimit: number; limitReached: boolean; skipped: number; rendered: number; collectedAt: string };
  limitations?: string[];
  ai?: { findingExplanations?: { ruleId: string; clientExplanation: string }[] } | null;
};

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ category?: string; severity?: string; tab?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const audit = await db.websiteAudit.findFirst({
    where: { id, workspaceId: session.workspace.id },
    include: {
      prospect: { select: { id: true, businessName: true, domain: true } },
      runs: true,
      crawlJob: true,
      findings: { orderBy: [{ priority: "desc" }], include: { evidence: true } },
      proposals: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
      screenshots: { orderBy: { createdAt: "asc" } },
      pages: { orderBy: { crawledAt: "asc" }, select: { id: true, url: true, finalUrl: true, httpStatus: true, title: true, pageType: true, wordCount: true, rendered: true, extractionError: true, responseTimeMs: true } },
    },
  });
  if (!audit) notFound();

  const active = audit.status === "QUEUED" || audit.status === "RUNNING";
  const finished = audit.status === "COMPLETED" || audit.status === "PARTIAL";
  const proposal = audit.proposals[0] ?? null;
  // The automatic proposal is drafted just after the audit completes: keep refreshing briefly until it appears.
  const awaitingProposal = finished && audit.autoProposal && !proposal && completedRecently(audit.completedAt);
  const runs = new Map(audit.runs.map((r) => [r.stage, r]));
  const analysis = (audit.analysis ?? {}) as Analysis;
  const explanations = new Map((analysis.ai?.findingExplanations ?? []).map((e) => [e.ruleId, e.clientExplanation]));
  const tab = sp.tab === "pages" ? "pages" : "findings";
  const findings = audit.findings.filter((f) => (!sp.category || f.category === sp.category) && (!sp.severity || f.severity === sp.severity));
  const severityCounts = SEVERITIES.map((s) => ({ s, n: audit.findings.filter((f) => f.severity === s).length }));
  const contactsFound = (runs.get("CONTACTS")?.output as { found?: number; created?: number } | undefined) ?? null;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ category: sp.category, severity: sp.severity, tab: sp.tab, ...o })) if (v) p.set(k, v);
    return `?${p}`;
  };

  return (
    <>
      <AutoRefresh active={active || awaitingProposal} />
      <PageHeader
        title={`Audit: ${audit.prospect.domain}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AuditStatusBadge status={audit.status} />
            <Link href={`/prospects/${audit.prospect.id}`} className="hover:text-primary">
              {audit.prospect.businessName}
            </Link>
            <span>· started {formatDate(audit.createdAt, true)}</span>
          </span>
        }
        actions={
          <>
            {(audit.status === "FAILED" || audit.status === "PARTIAL") && <RetryButton auditId={audit.id} />}
            {proposal ? (
              <Link href={`/proposals/${proposal.id}`} className={buttonClass("primary")}>
                <FileText className="h-4 w-4" /> Open proposal
              </Link>
            ) : finished && (
              <form action={createProposalAction}>
                <input type="hidden" name="prospectId" value={audit.prospect.id} />
                <input type="hidden" name="auditId" value={audit.id} />
                <button type="submit" className={buttonClass("primary")}>
                  <FileText className="h-4 w-4" /> Create proposal
                </button>
              </form>
            )}
            <Link href={`/prospects/${audit.prospect.id}/research?tab=performance`} className={buttonClass("secondary")}>
              Speed &amp; research
            </Link>
            <a href={audit.normalizedUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("secondary")}>
              <ExternalLink className="h-4 w-4" /> Open website
            </a>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Progress" description={active ? "You can leave this page; the audit keeps running." : undefined} />
          <ol className="space-y-0.5 p-3">
            {AUDIT_STAGES.map((s) => {
              const r = runs.get(s.key);
              const status = (r?.status ?? "PENDING") as keyof typeof STAGE_ICON;
              return (
                <li key={s.key} className={cn("flex gap-3 rounded-lg px-2 py-2", status === "RUNNING" && "bg-info-soft/60")}>
                  <span className="mt-0.5">{STAGE_ICON[status]}</span>
                  <div className="min-w-0">
                    <p className={cn("text-sm", status === "PENDING" && "text-muted")}>
                      {s.label}
                      {status !== "PENDING" && status !== "RUNNING" && status !== "COMPLETED" && <span className="ml-1.5 text-xs text-muted">({status.toLowerCase()})</span>}
                      {!r && !active && <span className="ml-1.5 text-xs text-muted">(added after this audit ran)</span>}
                    </p>
                    {r?.message && <p className="break-words text-xs text-muted">{r.message}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {proposal && audit.autoProposal && (
            <div className="animate-rise flex flex-col gap-4 rounded-2xl border border-success/30 bg-gradient-to-br from-success-soft to-surface p-5 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="flex items-center gap-2 font-semibold text-success">
                  <Sparkles className="h-5 w-5" /> Your proposal is ready
                </p>
                <p className="mt-1 text-sm text-muted">Drafted from this audit. Check it once, then send it by email or WhatsApp.</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/proposals/${proposal.id}`} className={buttonClass("secondary")}>
                  Review
                </Link>
                <Link href={`/proposals/${proposal.id}/send`} className={buttonClass("primary")}>
                  <Send className="h-4 w-4" /> Send to client
                </Link>
              </div>
            </div>
          )}
          {awaitingProposal && (
            <Alert tone="info" title="Preparing your proposal…">The audit is done; the proposal draft appears here in a few seconds.</Alert>
          )}
          {audit.status === "FAILED" && (
            <Alert tone="danger" title="The audit could not be completed">
              {audit.runs.find((r) => r.status === "FAILED")?.message ?? "An unexpected error occurred."} Use “Retry failed stages” to try again; completed stages are kept.
            </Alert>
          )}

          {audit.summary ? (
            <Card>
              <CardHeader title="Executive summary" description={analysis.summarySource ? `Source: ${analysis.summarySource}` : undefined} />
              <p className="whitespace-pre-wrap p-5 text-sm leading-relaxed">{audit.summary}</p>
              <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
                {severityCounts
                  .filter((x) => x.n > 0)
                  .map(({ s, n }) => (
                    <Link key={s} href={qs({ severity: sp.severity === s ? undefined : s, tab: undefined })} className={cn("rounded-full", sp.severity === s && "ring-2 ring-primary")}>
                      <SeverityBadge severity={s} />
                      <span className="sr-only">: </span>
                      <span className="ml-1 text-xs font-semibold">{n}</span>
                    </Link>
                  ))}
              </div>
            </Card>
          ) : active ? (
            <Card className="p-6 text-sm text-muted">
              {audit.crawlJob ? `Crawling… ${audit.crawlJob.pagesCrawled} pages so far.` : "Waiting to start…"} Findings appear here when analysis finishes.
            </Card>
          ) : null}

          {audit.screenshots.length > 0 && (
            <Card>
              <CardHeader title="Screenshots" description="Taken during the audit. They appear in the proposal next to the issues they show." />
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {audit.screenshots.map((s) => (
                  <a key={s.id} href={`/api/screenshots/${s.id}`} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-xl border border-border bg-surface-2 transition-all hover:-translate-y-0.5 hover:shadow-lift">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated image */}
                    <img src={`/api/screenshots/${s.id}`} alt={s.caption ?? "Screenshot"} loading="lazy" className={cn("w-full object-cover object-top", s.kind === "HOMEPAGE_MOBILE" ? "h-48 object-contain bg-navy" : "h-48")} />
                    <p className="truncate px-3 py-2 text-xs text-muted group-hover:text-text">{s.caption}</p>
                  </a>
                ))}
              </div>
            </Card>
          )}

          {analysis.business && (
            <Card>
              <CardHeader title="Business identification" description="Inferred from the website — unverified until you confirm it." />
              <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">Likely business name</dt>
                  <dd className="mt-0.5 font-medium">
                    {analysis.business.name?.value ?? "—"}
                    {analysis.business.nameCandidates.length > 1 && (
                      <span className="block text-xs font-normal text-warning">Other names seen: {analysis.business.nameCandidates.slice(1, 4).map((c) => c.value).join(", ")}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Contact details found</dt>
                  <dd className="mt-0.5">
                    {contactsFound?.found ?? 0} public values{" "}
                    <Link href={`/prospects/${audit.prospect.id}`} className="text-primary hover:underline">
                      review on prospect →
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Services (from service pages)</dt>
                  <dd className="mt-0.5">{analysis.business.services.map((s) => s.value).slice(0, 6).join(" · ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Locations / addresses</dt>
                  <dd className="mt-0.5">{analysis.business.locations.map((s) => s.value).slice(0, 4).join(" · ") || "—"}</dd>
                </div>
              </dl>
            </Card>
          )}
        </div>
      </div>

      {(audit.findings.length > 0 || audit.pages.length > 0) && (
        <div className="mt-6">
          <div className={`${tabBarClass} mb-3`} role="tablist">
            <Link href={qs({ tab: undefined })} role="tab" aria-selected={tab === "findings"} className={tabClass(tab === "findings")}>
              Findings ({audit.findings.length})
            </Link>
            <Link href={qs({ tab: "pages" })} role="tab" aria-selected={tab === "pages"} className={tabClass(tab === "pages")}>
              Crawled pages ({audit.pages.length})
            </Link>
            {tab === "findings" && (
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Link href={qs({ category: undefined })} className={buttonClass(!sp.category ? "secondary" : "ghost", "sm")}>
                  All categories
                </Link>
                {CATEGORIES.filter((c) => audit.findings.some((f) => f.category === c)).map((c) => (
                  <Link key={c} href={qs({ category: c })} className={buttonClass(sp.category === c ? "secondary" : "ghost", "sm")}>
                    {c}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {tab === "findings" ? (
            <Card>
              {findings.length === 0 ? (
                <EmptyState title="No findings match this filter" />
              ) : (
                <ul className="divide-y divide-border">
                  {findings.map((f) => {
                    const urls = f.affectedUrls as string[];
                    const update = updateFindingAction.bind(null, f.id);
                    return (
                      <li key={f.id} className={cn(f.resolutionStatus === "DISMISSED" && "opacity-60")}>
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 hover:bg-surface-2/50">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <SeverityBadge severity={f.severity} />
                                <EvidenceBadge status={f.evidenceStatus} />
                                <span className="text-xs text-muted">{f.category}</span>
                                {f.requiresAccess && <Badge tone="info">Needs access</Badge>}
                                {f.resolutionStatus !== "OPEN" && <Badge>{f.resolutionStatus.toLowerCase()}</Badge>}
                                {!f.includeInProposal && <Badge>not in proposal</Badge>}
                              </div>
                              <p className="mt-1.5 font-medium">{f.title}</p>
                              <p className="mt-0.5 line-clamp-2 text-sm text-muted">{f.observedFacts}</p>
                            </div>
                            <span className="shrink-0 text-xs tabular-nums text-muted" title="Priority score (0–100)">
                              P{f.priority}
                            </span>
                          </summary>
                          <div className="space-y-4 border-t border-border bg-surface-2/30 px-5 py-4 text-sm">
                            {explanations.get(f.ruleId) && (
                              <div className="rounded-lg border border-primary/20 bg-primary-soft/50 p-3">
                                <p className="text-xs font-medium text-primary">Client-friendly explanation (AI, mapped to this finding)</p>
                                <p className="mt-1">{explanations.get(f.ruleId)}</p>
                              </div>
                            )}
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <p className="text-xs font-medium text-muted">What was observed</p>
                                <p className="mt-1 break-words">{f.observedFacts}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted">Why it may matter</p>
                                <p className="mt-1">{f.businessImpact}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted">Recommended action</p>
                                <p className="mt-1">{f.recommendation}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted">How to verify</p>
                                <p className="mt-1">{f.verificationMethod}</p>
                                <p className="mt-2 text-xs text-muted">
                                  Confidence {f.confidence.toLowerCase()} · complexity {f.complexity.toLowerCase()}
                                  {f.requiresHumanReview ? " · human review required" : ""}
                                </p>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted">Affected URLs ({urls.length})</p>
                              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                                {urls.slice(0, 50).map((u) => (
                                  <li key={u} className="break-all">
                                    <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-primary">
                                      {u}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted">Evidence ({f.evidence.length})</p>
                              <ul className="mt-1 space-y-2">
                                {f.evidence.slice(0, 10).map((e) => (
                                  <li key={e.id} className="rounded-lg border border-border bg-surface p-3 text-xs">
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                                      <span className="font-medium text-text">{e.kind.replace(/_/g, " ").toLowerCase()}</span>
                                      <span>{e.method}</span>
                                      <span>{formatDate(e.collectedAt, true)}</span>
                                    </div>
                                    {e.url && <p className="mt-1 break-all">{e.url}</p>}
                                    {e.excerpt && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2 font-mono text-[11px]">{e.excerpt}</pre>}
                                    {e.measurement != null && (
                                      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(e.measurement, null, 1)}</pre>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(
                                [
                                  f.resolutionStatus === "OPEN" ? ["accept", "Accept finding"] : ["reopen", "Reopen"],
                                  f.resolutionStatus !== "DISMISSED" ? ["dismiss", "Dismiss (not a real issue)"] : null,
                                  f.includeInProposal ? ["exclude", "Exclude from proposal"] : ["include", "Include in proposal"],
                                ].filter(Boolean) as [string, string][]
                              ).map(([intent, label]) => (
                                <form key={intent} action={update}>
                                  <input type="hidden" name="intent" value={intent} />
                                  <button type="submit" className={buttonClass(intent === "dismiss" ? "ghost" : "secondary", "sm")}>
                                    {label}
                                  </button>
                                </form>
                              ))}
                            </div>
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">URL</th>
                      <th scope="col" className="px-4 py-3 font-medium">Status</th>
                      <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
                      <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">Words</th>
                      <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Title</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {audit.pages.map((p) => (
                      <tr key={p.id}>
                        <td className="max-w-xs px-4 py-2.5">
                          <a href={p.finalUrl ?? p.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate hover:text-primary" title={p.url}>
                            {new URL(p.url).pathname || "/"}
                          </a>
                          {p.extractionError && <span className="block truncate text-xs text-danger">{p.extractionError}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={!p.httpStatus || p.httpStatus >= 400 ? "danger" : p.url !== p.finalUrl ? "warning" : "success"}>{p.httpStatus ?? "error"}</Badge>
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted md:table-cell">
                          {p.pageType ? PAGE_TYPE_LABELS[p.pageType as PageType] : "—"}
                          {p.rendered && <span className="ml-1 text-xs">(JS rendered)</span>}
                        </td>
                        <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">{p.wordCount ?? "—"}</td>
                        <td className="hidden max-w-sm truncate px-4 py-2.5 text-muted lg:table-cell">{p.title ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {analysis.scope && (
        <Card className="mt-6">
          <CardHeader title="Scope and limitations" />
          <div className="grid gap-6 p-5 text-sm md:grid-cols-2">
            <ul className="space-y-1">
              <li>
                Pages analysed: <strong>{analysis.scope.pagesAnalysed}</strong> of {analysis.scope.pagesAttempted} fetched (limit {analysis.scope.pageLimit}
                {analysis.scope.limitReached ? ", reached" : ""})
              </li>
              <li>URLs skipped (robots.txt, non-HTML, account/cart pages): {analysis.scope.skipped}</li>
              <li>Pages rendered with a headless browser: {analysis.scope.rendered}</li>
              <li>Data collected: {formatDate(analysis.scope.collectedAt, true)}</li>
            </ul>
            <ul className="space-y-1.5">
              {(analysis.limitations ?? []).map((l) => (
                <li key={l} className="flex gap-2 text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <p className="mt-6 text-xs text-muted">
        Severity legend: {SEVERITIES.map((s) => SEVERITY_LABELS[s]).join(" · ")}. “Potential” items show a real signal that needs human judgement; “Needs data” items cannot be confirmed without access.
      </p>
    </>
  );
}
