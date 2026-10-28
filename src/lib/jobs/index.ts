import "server-only";
import "./handlers";
import { startWorker } from "./queue";
import { logger } from "../log";

export { enqueueJob, kickWorker } from "./queue";
export { JOB_TYPES } from "./handlers";

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DIGEST_CHECK_MS = 60 * 60 * 1000;
const CAMPAIGN_TICK_MS = 5 * 60 * 1000;
const state = globalThis as unknown as { __maintenanceTimer?: NodeJS.Timeout; __digestTimer?: NodeJS.Timeout; __campaignTimer?: NodeJS.Timeout };

/**
 * Starts the in-process job worker if it is not running yet. Called from the authenticated app
 * layout and whenever a job is queued, so queued work resumes after a server restart as soon as
 * anyone opens the app. The daily retention clean-up starts alongside it.
 */
export function ensureWorker() {
  startWorker();
  if (!state.__maintenanceTimer && process.env.DISABLE_MAINTENANCE !== "true") {
    const run = () =>
      import("../system")
        .then((m) => m.runMaintenance())
        .catch((e) => logger("system").error("maintenance failed", { err: e }));
    state.__maintenanceTimer = setInterval(run, MAINTENANCE_INTERVAL_MS);
    state.__maintenanceTimer.unref?.();
    setTimeout(run, 60_000).unref?.();
  }
  // Monday summary emails: checked hourly, sent once a week per workspace.
  if (!state.__digestTimer && process.env.DISABLE_MAINTENANCE !== "true" && process.env.DISABLE_DIGEST !== "true") {
    const digest = () =>
      import("../digest")
        .then((m) => m.runWeeklyDigests())
        .catch((e) => logger("digest").error("weekly summary check failed", { err: e }));
    state.__digestTimer = setInterval(digest, DIGEST_CHECK_MS);
    state.__digestTimer.unref?.();
    setTimeout(digest, 90_000).unref?.();
  }
  // Auto-send campaigns: one email per campaign at most every tick, in working hours, under the daily limit.
  if (!state.__campaignTimer && process.env.DISABLE_CAMPAIGNS !== "true") {
    const tick = () =>
      import("../campaigns")
        .then((m) => m.runCampaigns())
        .catch((e) => logger("campaigns").error("auto-send tick failed", { err: e }));
    state.__campaignTimer = setInterval(tick, CAMPAIGN_TICK_MS);
    state.__campaignTimer.unref?.();
    setTimeout(tick, 120_000).unref?.();
  }
}
