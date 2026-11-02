"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { GscError } from "@/lib/search-console";
import { RankError, addKeywords, removeKeyword, syncPositions } from "@/lib/rank-tracking";
import { checkUptime, resolveAlert } from "@/lib/site-alerts";
import { ReportDeliveryError, cancelReport, saveReportSchedule, sendReport } from "@/lib/report-delivery";
import { internalLinkSuggestions } from "@/lib/internal-links-run";
import type { LinkSuggestion } from "@/lib/internal-links";
import { db } from "@/lib/db";
import { monthKey, shiftMonth } from "@/lib/client-work";
import { CompetitorWatchError, addWatchedCompetitor, checkCompetitorNow, removeWatchedCompetitor } from "@/lib/competitor-watch";
import { checkRobotsAndSitemap, runIndexCheck } from "@/lib/site-health";
import { cannibalization, contentDecay, type Cannibalization, type DecayingPage } from "@/lib/gsc-analysis";
import { runLinkAudit } from "@/lib/link-audit-run";
import type { BrokenLink, CanonicalIssue, RedirectIssue } from "@/lib/link-audit";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof GscError || e instanceof RankError || e instanceof ReportDeliveryError || e instanceof CompetitorWatchError) return { ok: false, error: e.message };
  if (e instanceof Error && /respond|Blocked|could not be found|not found|ENOTFOUND|timed out/i.test(e.message)) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("websites", e)) };
}

async function run<T extends object>(websiteId: string, fn: (workspaceId: string, userId: string) => Promise<T>): Promise<R<T>> {
  const session = await requireSession();
  try {
    const out = await fn(session.workspace.id, session.user.id);
    revalidatePath(`/websites/${websiteId}`);
    return { ok: true, ...out };
  } catch (e) {
    return fail(e);
  }
}

export async function addKeywordsAction(websiteId: string, text: string) {
  return run(websiteId, async (ws) => {
    const added = await addKeywords(ws, websiteId, text);
    // Positions are read straight away when Search Console is linked; a failure here is shown, not hidden.
    const w = await db.website.findFirst({ where: { id: websiteId, workspaceId: ws }, select: { gscSiteUrl: true } });
    let syncError: string | null = null;
    if (w?.gscSiteUrl) await syncPositions(ws, websiteId).catch((e) => (syncError = e instanceof GscError ? e.message : "Positions could not be read yet."));
    return { added, syncError };
  });
}

export async function removeKeywordAction(websiteId: string, id: string) {
  return run(websiteId, async (ws) => (await removeKeyword(ws, id), {}));
}

export async function syncKeywordsAction(websiteId: string) {
  return run(websiteId, async (ws) => ({ count: await syncPositions(ws, websiteId) }));
}

export async function resolveAlertAction(websiteId: string, id: string) {
  return run(websiteId, async (ws) => (await resolveAlert(ws, id), {}));
}

export async function checkUptimeAction(websiteId: string) {
  return run(websiteId, async (ws) => ({ status: await checkUptime(ws, websiteId) }));
}

export async function saveReportScheduleAction(websiteId: string, input: { day: number | null; email: string; approval: boolean }) {
  return run(websiteId, async (ws) => (await saveReportSchedule(ws, websiteId, { day: input.day, email: input.email, approval: input.approval }), {}));
}

/** Prepares last month's report now (when the day has not come yet, or to send it again after a cancel). */
export async function prepareReportAction(websiteId: string) {
  return run(websiteId, async (ws) => {
    const w = await db.website.findFirst({ where: { id: websiteId, workspaceId: ws }, select: { reportEmail: true } });
    if (!w?.reportEmail) throw new ReportDeliveryError("Save the client's email first.");
    const month = shiftMonth(monthKey(), -1);
    await db.reportDelivery.upsert({
      where: { websiteId_month: { websiteId, month } },
      create: { workspaceId: ws, websiteId, month, to: w.reportEmail, status: "AWAITING_APPROVAL" },
      update: { to: w.reportEmail, status: "AWAITING_APPROVAL", error: null },
    });
    return {};
  });
}

export async function approveReportAction(websiteId: string, deliveryId: string) {
  return run(websiteId, async (ws, userId) => (await sendReport(ws, deliveryId, userId), {}));
}

export async function cancelReportAction(websiteId: string, deliveryId: string) {
  return run(websiteId, async (ws) => (await cancelReport(ws, deliveryId), {}));
}

export async function internalLinksAction(websiteId: string): Promise<R<{ pagesRead: number; usedSearchConsole: boolean; suggestions: LinkSuggestion[]; orphans: string[] }>> {
  const session = await requireSession();
  try {
    return { ok: true, ...(await internalLinkSuggestions(session.workspace.id, websiteId)) };
  } catch (e) {
    if (e instanceof Error && /respond|Blocked|could not be found|not found/i.test(e.message)) return { ok: false, error: e.message };
    return fail(e);
  }
}

export async function addCompetitorAction(websiteId: string, input: { name: string; url: string }) {
  return run(websiteId, async (ws) => {
    const c = await addWatchedCompetitor(ws, websiteId, input);
    // The first check records how the site looks today; changes are reported from the next one.
    const r = await checkCompetitorNow(ws, c.id).catch(() => null);
    return { pages: r?.pages ?? 0 };
  });
}

export async function removeCompetitorAction(websiteId: string, id: string) {
  return run(websiteId, async (ws) => (await removeWatchedCompetitor(ws, id), {}));
}

export async function checkCompetitorAction(websiteId: string, id: string) {
  return run(websiteId, async (ws) => {
    const r = await checkCompetitorNow(ws, id);
    return { changes: r.changes, baseline: r.baseline };
  });
}

export async function checkHealthAction(websiteId: string) {
  return run(websiteId, async (ws) => {
    const r = await checkRobotsAndSitemap(ws, websiteId);
    return { problems: r?.problems ?? [], sitemapUrls: r?.sitemapUrls ?? 0 };
  });
}

export async function checkIndexingAction(websiteId: string) {
  return run(websiteId, async (ws) => {
    const r = await runIndexCheck(ws, websiteId);
    return { inspected: r?.inspected ?? 0, errors: r?.errors ?? 0 };
  });
}

export async function linkAuditAction(websiteId: string): Promise<R<{ pagesChecked: number; externalChecked: number; broken: BrokenLink[]; redirects: RedirectIssue[]; canonicals: CanonicalIssue[] }>> {
  const session = await requireSession();
  try {
    return { ok: true, ...(await runLinkAudit(session.workspace.id, websiteId)) };
  } catch (e) {
    return fail(e);
  }
}

export async function gscAnalysisAction(websiteId: string, kind: "cannibalization" | "decay"): Promise<R<{ cannibal?: Cannibalization[]; decay?: DecayingPage[] }>> {
  const session = await requireSession();
  try {
    return kind === "decay" ? { ok: true, decay: await contentDecay(session.workspace.id, websiteId) } : { ok: true, cannibal: await cannibalization(session.workspace.id, websiteId) };
  } catch (e) {
    return fail(e);
  }
}

export async function createContentPlanAction(websiteId: string) {
  return run(websiteId, async (ws) => {
    const { ContentPlanError, createContentPlan } = await import("@/lib/content-calendar");
    try {
      const plan = await createContentPlan(ws, websiteId);
      return { items: plan.items.length, source: plan.source };
    } catch (e) {
      if (e instanceof ContentPlanError) throw new RankError(e.message);
      throw e;
    }
  });
}

export async function setPlanItemAction(websiteId: string, itemId: string, status: "PLANNED" | "DONE" | "SKIPPED") {
  return run(websiteId, async (ws) => {
    const { setPlanItemStatus } = await import("@/lib/content-calendar");
    await setPlanItemStatus(ws, itemId, status);
    return {};
  });
}
