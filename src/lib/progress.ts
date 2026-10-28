import "server-only";
import { db } from "./db";
import { logger } from "./log";

/**
 * Progress for won clients: each month the website is audited again on its own, and the client's
 * report compares the first audit (before our work) with the latest one — which problems are gone,
 * which remain, and how speed and Google reviews moved. Only saved audit data is compared.
 */

const DAY = 86400_000;
const DONE = ["COMPLETED", "PARTIAL"];
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const REAUDIT_EVERY_DAYS = 30;
/** Audits started per check, so a big client list never floods the job queue at once. */
const MAX_PER_TICK = 3;

type FindingRow = { ruleId: string; title: string; severity: string };

export type ProgressReport = {
  before: { auditId: string; date: Date };
  now: { auditId: string; date: Date };
  fixed: FindingRow[];
  remaining: FindingRow[];
  newIssues: FindingRow[];
  severity: { key: (typeof SEVERITIES)[number]; before: number; now: number }[];
  speed: { before: number | null; now: number | null };
  reviews: { before: { rating: number | null; count: number | null } | null; now: { rating: number | null; count: number | null } | null };
};

const countable = (f: { ruleId: string; severity: string }) => f.ruleId !== "CUSTOM" && f.severity !== "NEEDS_VERIFICATION" && f.severity !== "OPPORTUNITY";

export async function progressReport(workspaceId: string, prospectId: string): Promise<ProgressReport | null> {
  const audits = await db.websiteAudit.findMany({
    where: { workspaceId, prospectId, status: { in: DONE } },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, completedAt: true, findings: { select: { ruleId: true, title: true, severity: true } } },
  });
  if (audits.length < 2) return null;
  const first = audits[0];
  const last = audits[audits.length - 1];
  const a = first.findings.filter(countable);
  const b = last.findings.filter(countable);
  const nowRules = new Set(b.map((f) => f.ruleId));
  const beforeRules = new Set(a.map((f) => f.ruleId));
  const uniq = (xs: FindingRow[]) => [...new Map(xs.map((f) => [f.ruleId, { ruleId: f.ruleId, title: f.title, severity: f.severity }])).values()];
  const rank = (s: string) => (SEVERITIES as readonly string[]).indexOf(s);
  const bySeverity = (x: FindingRow, y: FindingRow) => rank(x.severity) - rank(y.severity);

  const [speedBefore, speedNow, gbp] = await Promise.all([
    db.performanceTest.findFirst({ where: { prospectId, auditId: first.id, strategy: "MOBILE", performanceScore: { not: null } }, select: { performanceScore: true } }),
    db.performanceTest.findFirst({ where: { prospectId, auditId: last.id, strategy: "MOBILE", performanceScore: { not: null } }, select: { performanceScore: true } }),
    db.gbpProfile.findMany({ where: { workspaceId, prospectId }, orderBy: { fetchedAt: "asc" }, select: { rating: true, reviewCount: true, fetchedAt: true } }),
  ]);
  const reviewsAt = (when: Date) => {
    const before = gbp.filter((g) => g.fetchedAt <= new Date(when.getTime() + DAY));
    const g = before.at(-1) ?? null;
    return g ? { rating: g.rating, count: g.reviewCount } : null;
  };
  const firstGbp = gbp[0] ? { rating: gbp[0].rating, count: gbp[0].reviewCount } : null;
  const lastGbp = gbp.at(-1) ? { rating: gbp.at(-1)!.rating, count: gbp.at(-1)!.reviewCount } : null;

  return {
    before: { auditId: first.id, date: first.completedAt ?? first.createdAt },
    now: { auditId: last.id, date: last.completedAt ?? last.createdAt },
    fixed: uniq(a.filter((f) => !nowRules.has(f.ruleId))).sort(bySeverity),
    remaining: uniq(b.filter((f) => beforeRules.has(f.ruleId))).sort(bySeverity),
    newIssues: uniq(b.filter((f) => !beforeRules.has(f.ruleId))).sort(bySeverity),
    severity: SEVERITIES.map((key) => ({ key, before: uniq(a.filter((f) => f.severity === key)).length, now: uniq(b.filter((f) => f.severity === key)).length })),
    speed: { before: speedBefore?.performanceScore ?? null, now: speedNow?.performanceScore ?? null },
    reviews: { before: reviewsAt(first.createdAt) ?? firstGbp, now: lastGbp },
  };
}

/**
 * Starts the monthly re-audit for won clients whose last audit is a month old. Runs from the
 * in-app timer; nothing is sent to the client — the result feeds the progress report.
 */
export async function runMonthlyReaudits(now = new Date()) {
  const { startAudit, AuditRequestError } = await import("./audit/service");
  const clients = await db.prospect.findMany({
    where: { status: "WON" },
    select: {
      id: true,
      workspaceId: true,
      websiteUrl: true,
      currency: true,
      ownerId: true,
      audits: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, status: true } },
    },
  });
  let started = 0;
  for (const c of clients) {
    if (started >= MAX_PER_TICK) break;
    const last = c.audits[0];
    if (last && (last.status === "QUEUED" || last.status === "RUNNING")) continue;
    if (last && now.getTime() - last.createdAt.getTime() < REAUDIT_EVERY_DAYS * DAY) continue;
    const userId = c.ownerId ?? (await db.workspaceMembership.findFirst({ where: { workspaceId: c.workspaceId, role: "OWNER" }, select: { userId: true } }))?.userId;
    if (!userId) continue;
    try {
      await startAudit(c.workspaceId, userId, { websiteUrl: c.websiteUrl, prospectId: c.id, currency: c.currency as "USD" }, { reaudit: true });
      started++;
    } catch (e) {
      if (!(e instanceof AuditRequestError)) throw e;
      logger("progress").warn("monthly re-audit skipped", { prospectId: c.id, reason: e.message });
    }
  }
  return started;
}
