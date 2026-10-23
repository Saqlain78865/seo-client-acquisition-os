import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, CircleAlert, CircleX, Download, ListChecks } from "lucide-react";
import { hasRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { JOB_STATUSES, RETENTION, listJobs, runHealthChecks, type HealthCheck } from "@/lib/system";
import { formatDate } from "@/lib/utils";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass, type BadgeTone, tabBarClass, tabClass } from "@/components/ui";
import { JobButtons, MaintenanceButton } from "./controls";

export const metadata: Metadata = { title: "System" };

const CHECK_ICON = {
  ok: <CheckCircle2 className="h-4 w-4 text-success" aria-label="OK" />,
  warn: <CircleAlert className="h-4 w-4 text-warning" aria-label="Warning" />,
  fail: <CircleX className="h-4 w-4 text-danger" aria-label="Failed" />,
} satisfies Record<HealthCheck["status"], React.ReactNode>;

const JOB_TONE: Record<string, BadgeTone> = { FAILED: "danger", QUEUED: "info", RUNNING: "primary", COMPLETED: "success", RETRIED: "neutral", DISMISSED: "neutral" };
const JOB_LABEL: Record<string, string> = { "audit.run": "Website audit" };

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireSession();
  if (!hasRole(session, "ADMIN")) {
    return (
      <>
        <PageHeader title="System" />
        <Alert tone="info">Only owners and admins can view system health and background jobs.</Alert>
      </>
    );
  }
  const isOwner = hasRole(session, "OWNER");
  const { status: raw } = await searchParams;
  const counts = await db.backgroundJob.groupBy({ by: ["status"], where: { workspaceId: session.workspace.id }, _count: { _all: true } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const status = (JOB_STATUSES as readonly string[]).includes(raw ?? "") ? raw! : count("FAILED") > 0 ? "FAILED" : "ALL";
  const [checks, jobs] = await Promise.all([runHealthChecks(), listJobs(session.workspace.id, status === "ALL" ? undefined : status)]);
  const failing = checks.filter((c) => c.status === "fail").length;

  return (
    <>
      <PageHeader title="System" description="Health of this installation, background jobs and data retention." />
      {failing > 0 && (
        <Alert tone="danger" className="mb-4" title={`${failing} check${failing === 1 ? "" : "s"} failing`}>
          Some features will not work until this is fixed. See docs/TROUBLESHOOTING.md.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Health checks" description="Run live each time this page loads." />
            <ul className="divide-y divide-border">
              {checks.map((c) => (
                <li key={c.key} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <span className="mt-0.5">{CHECK_ICON[c.status]}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{c.label}</p>
                    <p className="break-words text-xs text-muted">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Background jobs" description="Audits run in the background. Failed jobs can be retried safely — finished audit stages are kept." />
            <div className="border-b border-border px-5 py-3" role="presentation"><div className={tabBarClass} role="tablist" aria-label="Job status">
              {["ALL", ...JOB_STATUSES].map((s) => (
                <Link key={s} href={`/system?status=${s}`} role="tab" aria-selected={status === s} className={tabClass(status === s)}>
                  {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                  {s !== "ALL" && count(s) > 0 && <span className="tabular-nums opacity-75">{count(s)}</span>}
                </Link>
              ))}
            </div>
            </div>
            {jobs.length === 0 ? (
              <EmptyState icon={<ListChecks className="h-5 w-5" />} title="No jobs here" description={status === "FAILED" ? "Nothing has failed." : undefined} />
            ) : (
              <ul className="divide-y divide-border">
                {jobs.map((j) => (
                  <li key={j.id} className="space-y-1.5 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={JOB_TONE[j.status] ?? "neutral"}>{j.status.toLowerCase()}</Badge>
                      <span className="font-medium">{JOB_LABEL[j.type] ?? j.type}</span>
                      {j.target && (
                        <Link href={j.target.href} className="text-primary hover:underline">
                          {j.target.label}
                        </Link>
                      )}
                      <span className="ml-auto text-xs text-muted">{formatDate(j.updatedAt, true)}</span>
                    </div>
                    <p className="text-xs text-muted">
                      Attempt {j.attempts} of {j.maxAttempts}
                      {j.correlationId && <> · ref <code className="font-mono">{j.correlationId.slice(0, 8)}</code></>}
                    </p>
                    {j.lastError && <p className="break-words rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{j.lastError}</p>}
                    {j.status === "FAILED" && <JobButtons jobId={j.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Data retention" description="Runs automatically once a day." />
            <div className="space-y-3 p-5 text-sm">
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
                <li>Expired sign-in sessions: removed</li>
                <li>Login attempts: kept {RETENTION.loginAttemptsDays} days</li>
                <li>Finished background jobs: kept {RETENTION.finishedJobsDays} days</li>
                <li>Read notifications: kept {RETENTION.readNotificationsDays} days</li>
                <li>PDFs and logos of deleted records: removed from disk</li>
                <li>Prospects, audits and proposals: kept until you delete them</li>
              </ul>
              {isOwner ? <MaintenanceButton /> : <p className="text-xs text-muted">Only owners can run the clean-up manually.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Export workspace data" description="Everything in this workspace as one JSON file." />
            <div className="space-y-3 p-5 text-sm">
              <p className="text-xs text-muted">Passwords, sign-in tokens, integration credentials and share-link tokens are never included.</p>
              {isOwner ? (
                <a href="/api/workspace/export" className={buttonClass("secondary", "sm")}>
                  <Download className="h-4 w-4" /> Download export
                </a>
              ) : (
                <p className="text-xs text-muted">Only owners can export the workspace.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Monitoring" />
            <div className="space-y-2 p-5 text-xs text-muted">
              <p className="flex items-center gap-2">
                <Activity className="h-4 w-4" /> Uptime check: <code className="font-mono">/api/health</code>
              </p>
              <p>Every response carries an <code className="font-mono">x-request-id</code> header. Error messages show the first 8 characters as a reference — search the server logs for it.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
