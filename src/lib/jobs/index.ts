import "server-only";
import "./handlers";
import { startWorker } from "./queue";
import { logger } from "../log";

export { enqueueJob, kickWorker } from "./queue";
export { JOB_TYPES } from "./handlers";

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DIGEST_CHECK_MS = 60 * 60 * 1000;
const CAMPAIGN_TICK_MS = 5 * 60 * 1000;
const MONITOR_TICK_MS = 15 * 60 * 1000;
const state = globalThis as unknown as { __maintenanceTimer?: NodeJS.Timeout; __digestTimer?: NodeJS.Timeout; __campaignTimer?: NodeJS.Timeout; __reauditTimer?: NodeJS.Timeout; __trackingTimer?: NodeJS.Timeout; __monitorTimer?: NodeJS.Timeout };

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
  // Tracked websites (My Websites and won clients): a check of the live site for changes every week.
  if (!state.__trackingTimer && process.env.DISABLE_MAINTENANCE !== "true" && process.env.DISABLE_TRACKING !== "true") {
    const track = () =>
      import("../site-changes")
        .then((m) => m.runWeeklyChangeChecks())
        .catch((e) => logger("tracking").error("tracking check failed", { err: e }));
    state.__trackingTimer = setInterval(track, DIGEST_CHECK_MS);
    state.__trackingTimer.unref?.();
    setTimeout(track, 240_000).unref?.();
  }
  // Every 15 minutes: uptime, Gmail replies, Calendar follow-ups and lead scores; daily Search Console checks and Drive backup; monthly report emails on each client's day.
  if (!state.__monitorTimer && process.env.DISABLE_MAINTENANCE !== "true" && process.env.DISABLE_TRACKING !== "true") {
    const monitor = () =>
      Promise.all([import("../site-alerts"), import("../report-delivery"), import("../site-health"), import("../reply-detection"), import("../calendar-sync"), import("../drive-backup"), import("../lead-score")])
        .then(([alerts, reports, health, replies, calendar, drive, leads]) =>
          Promise.allSettled([alerts.runSiteMonitoring(), reports.runReportSchedules(), health.runSiteHealth(), replies.runReplyChecks(), calendar.runCalendarSync(), drive.runDriveBackups(), leads.runLeadScores()]),
        )
        .then((done) => done.forEach((r) => r.status === "rejected" && logger("monitoring").error("monitoring tick failed", { err: r.reason })))
        .catch((e) => logger("monitoring").error("monitoring tick failed", { err: e }));
    state.__monitorTimer = setInterval(monitor, MONITOR_TICK_MS);
    state.__monitorTimer.unref?.();
    setTimeout(monitor, 150_000).unref?.();
  }
  // Won clients: their website is audited again once a month for the progress report.
  if (!state.__reauditTimer && process.env.DISABLE_MAINTENANCE !== "true" && process.env.DISABLE_REAUDITS !== "true") {
    const reaudit = () =>
      import("../progress")
        .then((m) => m.runMonthlyReaudits())
        .catch((e) => logger("progress").error("monthly re-audit check failed", { err: e }));
    state.__reauditTimer = setInterval(reaudit, DIGEST_CHECK_MS);
    state.__reauditTimer.unref?.();
    setTimeout(reaudit, 180_000).unref?.();
  }
}
