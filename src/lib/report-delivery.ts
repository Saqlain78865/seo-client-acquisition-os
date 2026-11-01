import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { logger } from "./log";
import { notify } from "./notifications";
import { logActivity } from "./activity";
import { monthKey, monthLabel, shiftMonth } from "./client-work";
import { appUrl } from "./messaging/share";
import { EmailError, sendEmail } from "./messaging/email";
import { launchChromium } from "./crawler/browser";

/**
 * Monthly report emails for My Websites. On the day chosen for each client (1–28), the report of
 * the month just ended is prepared as a PDF. By default it waits for approval in the app; a website
 * can be set to send without waiting. It goes out from the connected Gmail account.
 */

export class ReportDeliveryError extends Error {}

const log = logger("report-delivery");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveReportSchedule(workspaceId: string, websiteId: string, input: { day: number | null; email: string | null; approval: boolean }) {
  const email = input.email?.trim().toLowerCase() || null;
  if (input.day != null && (!Number.isInteger(input.day) || input.day < 1 || input.day > 28)) throw new ReportDeliveryError("Pick a day from 1 to 28 (every month has those days).");
  if (input.day != null && !email) throw new ReportDeliveryError("Enter the client's email address.");
  if (email && !EMAIL.test(email)) throw new ReportDeliveryError("That email address does not look right.");
  const { count } = await db.website.updateMany({ where: { id: websiteId, workspaceId }, data: { reportDay: input.day, reportEmail: email, reportApproval: input.approval } });
  if (!count) throw new ReportDeliveryError("Website not found.");
}

// ── Signed print link: lets the PDF engine open one report for a few minutes without a login. ──

const linkKey = () => createHmac("sha256", process.env.ENCRYPTION_KEY ?? "").update("website-report-print").digest();

export function signReportLink(workspaceId: string, websiteId: string, month: string, ttlMs = 10 * 60_000) {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, s: websiteId, m: month, e: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${createHmac("sha256", linkKey()).update(body).digest("base64url")}`;
}

export function readReportLink(token: string): { workspaceId: string; websiteId: string; month: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", linkKey()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { w: string; s: string; m: string; e: number };
    return p.e > Date.now() ? { workspaceId: p.w, websiteId: p.s, month: p.m } : null;
  } catch {
    return null;
  }
}

/** Prints the website report page (the same one shown in the app) to PDF. */
export async function reportPdf(workspaceId: string, websiteId: string, month: string): Promise<Buffer> {
  const base = appUrl();
  const url = `${base}/website-report?site=${encodeURIComponent(websiteId)}&month=${month}&k=${encodeURIComponent(signReportLink(workspaceId, websiteId, month))}`;
  const { chromium } = await import("playwright");
  const browser = await launchChromium(chromium, { headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false });
    // Only the app itself: the report needs nothing from elsewhere.
    await context.route("**/*", (route) => (route.request().url().startsWith(base) || route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    // The page can keep a background connection open; a short settle is enough for fonts and charts.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    if (!res || !res.ok()) throw new ReportDeliveryError(`The report page could not be opened (HTTP ${res?.status() ?? "no answer"}).`);
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    await context.close();
    return pdf;
  } finally {
    await browser.close();
  }
}

/** Builds the PDF and emails it; records the outcome on the delivery. */
export async function sendReport(workspaceId: string, deliveryId: string, userId: string | null) {
  const d = await db.reportDelivery.findFirst({ where: { id: deliveryId, workspaceId }, include: { website: true } });
  if (!d) throw new ReportDeliveryError("Report not found.");
  if (d.status === "SENT") throw new ReportDeliveryError("This report was already sent.");
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId }, select: { companyName: true, consultantName: true } });
  const from = settings?.consultantName || settings?.companyName || "Your SEO team";
  try {
    const pdf = await reportPdf(workspaceId, d.websiteId, d.month);
    await sendEmail(workspaceId, {
      to: d.to,
      subject: `${d.website.name} — SEO report for ${monthLabel(d.month)}`,
      text: `Hi,\n\nPlease find attached the SEO report for ${d.website.domain} for ${monthLabel(d.month)}: results from Google Search Console, the work completed and the plan for next month.\n\nBest regards,\n${from}`,
      attachments: [{ filename: `${d.website.domain}-seo-report-${d.month}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
    await db.reportDelivery.update({ where: { id: d.id }, data: { status: "SENT", sentAt: new Date(), error: null, approvedById: userId } });
    if (userId) await logActivity({ workspaceId, userId, type: "website.report_sent", message: `${monthLabel(d.month)} report for ${d.website.domain} emailed to ${d.to}` }).catch(() => {});
    return { ok: true as const };
  } catch (e) {
    const message = e instanceof EmailError || e instanceof ReportDeliveryError ? e.message : `Sending failed: ${(e as Error).message.split("\n")[0]}`;
    await db.reportDelivery.update({ where: { id: d.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    throw new ReportDeliveryError(message);
  }
}

export async function cancelReport(workspaceId: string, deliveryId: string) {
  const { count } = await db.reportDelivery.updateMany({ where: { id: deliveryId, workspaceId, status: { in: ["AWAITING_APPROVAL", "FAILED"] } }, data: { status: "CANCELLED" } });
  if (!count) throw new ReportDeliveryError("Only a report that has not been sent can be cancelled.");
}

/**
 * Hourly: websites whose report day has come this month get last month's report prepared (once).
 * It then waits for approval, or is sent straight away when the website is set to send without it.
 */
export async function runReportSchedules(now = new Date()) {
  const month = shiftMonth(monthKey(now), -1);
  const due = await db.website.findMany({
    where: { reportDay: { not: null, lte: now.getDate() }, reportEmail: { not: null }, reports: { none: { month } } },
    select: { id: true, workspaceId: true, name: true, reportEmail: true, reportApproval: true },
    take: 5,
  });
  for (const w of due) {
    const d = await db.reportDelivery.create({ data: { workspaceId: w.workspaceId, websiteId: w.id, month, to: w.reportEmail!, status: "AWAITING_APPROVAL" } });
    if (w.reportApproval) {
      await notify({ workspaceId: w.workspaceId, title: `${w.name}: ${monthLabel(month)} report is ready to send`, body: `Check it and approve to email it to ${w.reportEmail}.`, link: `/websites/${w.id}#report-email` });
      continue;
    }
    await sendReport(w.workspaceId, d.id, null).then(
      () => notify({ workspaceId: w.workspaceId, title: `${w.name}: ${monthLabel(month)} report emailed to ${w.reportEmail}`, link: `/websites/${w.id}#report-email` }),
      (e) => {
        log.warn("scheduled report failed", { websiteId: w.id, reason: (e as Error).message });
        return notify({ workspaceId: w.workspaceId, title: `${w.name}: the ${monthLabel(month)} report could not be sent`, body: (e as Error).message, link: `/websites/${w.id}#report-email` });
      },
    );
  }
  return due.length;
}
