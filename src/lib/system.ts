import "server-only";
import fs from "node:fs/promises";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { logActivity } from "./activity";
import { logger } from "./log";
import { checkStorageWritable, deleteFile, fileModifiedAt, listFiles } from "./storage";
import { AuditRequestError, retryAudit } from "./audit/service";
import { JOB_TYPES } from "./jobs/handlers";
import { kickWorker, workerStatus } from "./jobs/queue";

const log = logger("system");

export class SystemError extends Error {}

// ───────────────────────────── Health checks ─────────────────────────────

export type HealthCheck = { key: string; label: string; status: "ok" | "warn" | "fail"; detail: string };

async function check(key: string, label: string, fn: () => Promise<Omit<HealthCheck, "key" | "label">>): Promise<HealthCheck> {
  try {
    return { key, label, ...(await fn()) };
  } catch (e) {
    return { key, label, status: "fail", detail: e instanceof Error ? e.message.split("\n")[0] : "Check failed" };
  }
}

/** Fast checks that need no login: used by /api/health for uptime monitors. */
export async function databaseHealthy() {
  const started = Date.now();
  await db.$queryRawUnsafe("SELECT 1");
  return Date.now() - started;
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  const production = process.env.NODE_ENV === "production";
  const desktop = process.env.SEO_OS_DESKTOP === "1";
  const database = await check("database", "Database", async () => {
    const ms = await databaseHealthy();
    return { status: ms > 500 ? "warn" : "ok", detail: `Responded in ${ms} ms` };
  });
  const rest = await Promise.all([
    check("encryption", "Encryption key", async () => {
      // Round-trips a value, which proves the key is present and valid.
      if (decryptSecret(encryptSecret("probe")) !== "probe") throw new Error("Encryption round-trip failed");
      return { status: "ok", detail: "ENCRYPTION_KEY is set and valid (AES-256-GCM)" };
    }),
    check("appUrl", "Public app URL", async () => {
      const raw = process.env.APP_URL?.trim();
      if (!raw) return { status: production ? "fail" : "warn", detail: "APP_URL is not set — share links and Google sign-in need it" };
      const u = new URL(raw);
      if (desktop) return { status: "ok", detail: `Desktop app on this PC (${u.origin}). Share links only open on this PC — email the PDF to clients.` };
      if (production && u.protocol !== "https:") return { status: "warn", detail: `${u.origin} is not HTTPS` };
      if (production && ["localhost", "127.0.0.1"].includes(u.hostname)) return { status: "warn", detail: `${u.origin} is not reachable by clients` };
      return { status: "ok", detail: u.origin };
    }),
    check("storage", "File storage", async () => ({ status: "ok", detail: `Writable: ${await checkStorageWritable()}` })),
    check("pdf", "PDF / rendering engine", async () => {
      const channel = process.env.BROWSER_CHANNEL?.trim();
      if (channel === "msedge") {
        const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"];
        for (const p of edge) {
          try {
            await fs.access(p);
            return { status: "ok", detail: "Microsoft Edge (installed with Windows)" };
          } catch {
            // try the next location
          }
        }
      }
      const { chromium } = await import("playwright");
      const exe = chromium.executablePath();
      try {
        await fs.access(exe);
      } catch {
        return { status: "fail", detail: "Chromium is not installed. Run: npx playwright install chromium" };
      }
      return { status: "ok", detail: "Chromium is installed" };
    }),
    check("worker", "Background worker", async () => {
      const w = workerStatus();
      const counts = await db.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } });
      const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
      const oldest = await db.backgroundJob.findFirst({ where: { status: "QUEUED", runAfter: { lte: new Date() } }, orderBy: { createdAt: "asc" } });
      const stuckMin = oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 60_000) : 0;
      const summary = `${n("QUEUED")} queued, ${n("RUNNING")} running, ${n("FAILED")} failed`;
      if (!w.started) return { status: "warn", detail: `Not started in this process yet · ${summary}` };
      if (stuckMin >= 10) return { status: "warn", detail: `A job has waited ${stuckMin} min · ${summary}` };
      return { status: "ok", detail: n("FAILED") > 0 ? `Running · ${summary} (usually a website that could not be reached — retry or dismiss them below)` : `Running · ${summary}` };
    }),
    check("registration", "Self-registration", async () =>
      process.env.ALLOW_REGISTRATION === "true"
        ? { status: "warn", detail: "ALLOW_REGISTRATION=true — anyone who finds the URL can create a workspace" }
        : { status: "ok", detail: "Closed — owners add team members from Account & Team" },
    ),
  ]);
  return [database, ...rest];
}

// ───────────────────────────── Jobs ─────────────────────────────

export const JOB_STATUSES = ["FAILED", "QUEUED", "RUNNING", "COMPLETED", "RETRIED", "DISMISSED"] as const;

export async function listJobs(workspaceId: string, status?: string) {
  const jobs = await db.backgroundJob.findMany({
    where: { workspaceId, ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const auditIds = jobs.map((j) => (j.payload as { auditId?: string }).auditId).filter((x): x is string => !!x);
  const audits = await db.websiteAudit.findMany({ where: { id: { in: auditIds }, workspaceId }, select: { id: true, status: true, prospect: { select: { businessName: true } } } });
  return jobs.map((j) => {
    const auditId = (j.payload as { auditId?: string }).auditId;
    const audit = audits.find((a) => a.id === auditId);
    return { ...j, target: audit ? { href: `/audits/${audit.id}`, label: audit.prospect.businessName, status: audit.status } : null };
  });
}

/**
 * Retries a failed job without duplicating work: audits go through retryAudit (completed stages are
 * kept, a fresh job is queued and this one is marked RETRIED); other jobs are re-queued in place.
 * The conditional update makes double clicks harmless — only one retry can win.
 */
export async function retryJob(workspaceId: string, userId: string, jobId: string) {
  const job = await db.backgroundJob.findFirst({ where: { id: jobId, workspaceId } });
  if (!job) throw new SystemError("Job not found.");
  if (job.status !== "FAILED") throw new SystemError("Only failed jobs can be retried.");

  if (job.type === JOB_TYPES.AUDIT_RUN) {
    const auditId = String((job.payload as { auditId?: string }).auditId ?? "");
    const audit = await db.websiteAudit.findFirst({ where: { id: auditId, workspaceId } });
    if (!audit) throw new SystemError("The audit for this job was deleted. Dismiss the job instead.");
    const claimed = await db.backgroundJob.updateMany({ where: { id: job.id, status: "FAILED" }, data: { status: "RETRIED" } });
    if (claimed.count !== 1) throw new SystemError("This job was already retried.");
    try {
      await retryAudit(workspaceId, auditId);
    } catch (e) {
      await db.backgroundJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
      throw e instanceof AuditRequestError ? new SystemError(e.message) : e;
    }
  } else {
    const claimed = await db.backgroundJob.updateMany({
      where: { id: job.id, status: "FAILED" },
      data: { status: "QUEUED", maxAttempts: job.attempts + 1, runAfter: new Date(), lockedAt: null },
    });
    if (claimed.count !== 1) throw new SystemError("This job was already retried.");
    void kickWorker();
  }
  await logActivity({ workspaceId, userId, type: "system.job_retried", message: `Retried background job (${job.type})`, metadata: { jobId: job.id, correlationId: job.correlationId } });
  log.info("job retried by admin", { jobId: job.id, type: job.type, userId, correlationId: job.correlationId });
}

export async function dismissJob(workspaceId: string, userId: string, jobId: string) {
  const { count } = await db.backgroundJob.updateMany({ where: { id: jobId, workspaceId, status: "FAILED" }, data: { status: "DISMISSED" } });
  if (count !== 1) throw new SystemError("Only failed jobs can be dismissed.");
  await logActivity({ workspaceId, userId, type: "system.job_dismissed", message: "Dismissed a failed background job", metadata: { jobId } });
}

// ───────────────────────────── Retention ─────────────────────────────

export const RETENTION = {
  loginAttemptsDays: 30,
  finishedJobsDays: 30,
  readNotificationsDays: 90,
} as const;

export type MaintenanceResult = {
  expiredSessions: number;
  loginAttempts: number;
  finishedJobs: number;
  notifications: number;
  orphanFiles: number;
};

const daysAgo = (d: number, now: number) => new Date(now - d * 86_400_000);

/**
 * Deletes data the app no longer needs: expired sessions, old login attempts, finished jobs, read
 * notifications, and stored files (PDFs, logos, audit screenshots) whose database record was deleted — so deleting a
 * prospect or proposal really removes its documents from disk.
 */
export async function runMaintenance(now = Date.now()): Promise<MaintenanceResult> {
  const [s, l, j, n] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: daysAgo(RETENTION.loginAttemptsDays, now) } } }),
    db.backgroundJob.deleteMany({ where: { status: { in: ["COMPLETED", "RETRIED", "DISMISSED"] }, updatedAt: { lt: daysAgo(RETENTION.finishedJobsDays, now) } } }),
    db.notification.deleteMany({ where: { readAt: { lt: daysAgo(RETENTION.readNotificationsDays, now) } } }),
  ]);

  const [attachments, logos, workspaces, shots] = await Promise.all([
    db.proposalAttachment.findMany({ select: { storageKey: true } }),
    db.workspaceSettings.findMany({ where: { logoPath: { not: null } }, select: { logoPath: true } }),
    db.workspace.findMany({ select: { id: true } }),
    db.auditScreenshot.findMany({ select: { storageKey: true } }),
  ]);
  const referenced = new Set([...attachments.map((a) => a.storageKey), ...logos.map((l) => l.logoPath!), ...shots.map((x) => x.storageKey)]);
  const files = [...(await listFiles("proposals")), ...(await listFiles("logos")), ...(await listFiles("screenshots"))];
  const known = new Set(workspaces.map((w) => w.id));
  // Only files of workspaces that exist in this database are swept, so pointing the app at the wrong or
  // an empty database can never wipe the storage folder. Files written in the last hour are skipped,
  // in case their database row is still being created.
  let orphanFiles = 0;
  for (const key of files) {
    if (referenced.has(key) || !known.has(key.split("/")[1])) continue;
    const modified = await fileModifiedAt(key);
    if (modified !== null && now - modified < 3_600_000) continue;
    await deleteFile(key);
    orphanFiles++;
  }

  const result = { expiredSessions: s.count, loginAttempts: l.count, finishedJobs: j.count, notifications: n.count, orphanFiles };
  log.info("maintenance finished", result);
  return result;
}

// ───────────────────────────── Export ─────────────────────────────

/**
 * Everything the workspace owns, as JSON. Secrets are excluded on purpose: password hashes,
 * session tokens, encrypted integration credentials and share-link tokens never leave the server.
 */
export async function exportWorkspace(workspaceId: string) {
  const where = { workspaceId };
  const [workspace, members, settings, prospects, audits, proposals, deals, followUps, templates, packages, statuses, activities, keywords, clusters, competitors, imports, performance, integrations] =
    await Promise.all([
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true, name: true, createdAt: true } }),
      db.workspaceMembership.findMany({ where, select: { role: true, createdAt: true, user: { select: { name: true, email: true } } } }),
      db.workspaceSettings.findUnique({ where }),
      db.prospect.findMany({ where, include: { contacts: true, meetingNotes: true } }),
      db.websiteAudit.findMany({ where, include: { findings: true, evidence: true, runs: true, crawlJob: true, pages: true } }),
      db.proposal.findMany({ where, omit: { shareToken: true }, include: { versions: { include: { sections: true, attachments: { omit: { storageKey: true } } } }, emailDeliveries: true, whatsappDeliveries: true } }),
      db.deal.findMany({ where }),
      db.followUp.findMany({ where }),
      db.messageTemplate.findMany({ where }),
      db.pricingPackage.findMany({ where }),
      db.pipelineStatus.findMany({ where }),
      db.activityLog.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.keyword.findMany({ where }),
      db.keywordCluster.findMany({ where }),
      db.competitor.findMany({ where, include: { observations: true } }),
      db.dataImport.findMany({ where, include: { referringDomains: true, searchConsoleRows: true } }),
      db.performanceTest.findMany({ where }),
      db.integrationConnection.findMany({ where, select: { provider: true, status: true, accountLabel: true, lastTestedAt: true, createdAt: true } }),
    ]);
  return {
    format: "seo-client-acquisition-os/export",
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Passwords, session tokens, integration credentials and share-link tokens are deliberately not included.",
    workspace,
    members,
    settings,
    prospects,
    audits,
    proposals,
    deals,
    followUps,
    templates,
    pricingPackages: packages,
    pipelineStatuses: statuses,
    activities,
    research: { keywords, clusters, competitors, imports, performanceTests: performance },
    integrations,
  };
}
