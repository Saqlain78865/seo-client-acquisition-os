import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { logger } from "../log";

const log = logger("jobs");

/**
 * Small database-backed job queue (no Redis needed). Jobs survive restarts; each job is claimed
 * with a conditional update, so it never runs twice. Up to JOB_CONCURRENCY jobs (default 3) run at
 * the same time — a bulk audit of 10 websites no longer waits for each site in turn.
 */

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; attempts: number; correlationId: string | null }) => Promise<void>;

const handlers = new Map<string, JobHandler>();
export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueueJob(workspaceId: string, type: string, payload: Record<string, unknown>, opts: { maxAttempts?: number; correlationId?: string } = {}) {
  const job = await db.backgroundJob.create({
    data: { workspaceId, type, payload: payload as object, maxAttempts: opts.maxAttempts ?? 1, correlationId: opts.correlationId ?? randomUUID() },
  });
  void kickWorker();
  return job;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

async function claimNext() {
  // Jobs locked by a crashed process are released after STALE_LOCK_MS.
  await db.backgroundJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "QUEUED", lockedAt: null, lastError: "Worker stopped unexpectedly; job re-queued" },
  });
  // Parallel workers may pick the same job; the loser simply tries the next one.
  for (let tries = 0; tries < 5; tries++) {
    const candidate = await db.backgroundJob.findFirst({ where: { status: "QUEUED", runAfter: { lte: new Date() } }, orderBy: { createdAt: "asc" } });
    if (!candidate) return null;
    const { count } = await db.backgroundJob.updateMany({
      where: { id: candidate.id, status: "QUEUED" },
      data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 1) return { ...candidate, attempts: candidate.attempts + 1 };
  }
  return null;
}

async function runOne(): Promise<boolean> {
  const job = await claimNext();
  if (!job) return false;
  const handler = handlers.get(job.type);
  if (!handler) {
    await db.backgroundJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: `No handler for job type ${job.type}` } });
    return true;
  }
  const ctx = { jobId: job.id, type: job.type, correlationId: job.correlationId, attempt: job.attempts };
  log.info("job started", ctx);
  try {
    await handler(job.payload as Record<string, unknown>, { id: job.id, attempts: job.attempts, correlationId: job.correlationId });
    await db.backgroundJob.update({ where: { id: job.id }, data: { status: "COMPLETED", lockedAt: null, lastError: null } });
    log.info("job completed", ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const retry = job.attempts < job.maxAttempts;
    await db.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: retry ? "QUEUED" : "FAILED",
        lockedAt: null,
        lastError: message.slice(0, 1000),
        runAfter: retry ? new Date(Date.now() + 30_000 * job.attempts) : undefined,
      },
    });
    log[retry ? "warn" : "error"](retry ? "job failed, will retry" : "job failed", { ...ctx, err: e });
  }
  return true;
}

const state = globalThis as unknown as { __jobWorker?: { running: number; timer?: NodeJS.Timeout } };

function maxParallel() {
  const n = Number(process.env.JOB_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 6) : 3;
}

/** Fills the free worker slots; each slot processes jobs until the queue is empty. Safe to call repeatedly. */
export async function kickWorker() {
  state.__jobWorker ??= { running: 0 };
  const w = state.__jobWorker;
  const slots: Promise<void>[] = [];
  while (w.running < maxParallel()) {
    w.running++;
    slots.push(
      (async () => {
        try {
          while (await runOne()) {
            // keep draining
          }
        } catch (e) {
          log.error("worker error", { err: e });
        } finally {
          w.running--;
        }
      })(),
    );
  }
  await Promise.all(slots);
}

/** Polls for jobs (delayed retries, jobs queued by other processes). Started once per server process. */
export function startWorker(intervalMs = 5000) {
  state.__jobWorker ??= { running: 0 };
  if (state.__jobWorker.timer) return;
  state.__jobWorker.timer = setInterval(() => void kickWorker(), intervalMs);
  state.__jobWorker.timer.unref?.();
  void kickWorker();
}

/** For the System page: whether this server process has started its worker loop. */
export function workerStatus() {
  return { started: !!state.__jobWorker?.timer, busy: (state.__jobWorker?.running ?? 0) > 0 };
}
