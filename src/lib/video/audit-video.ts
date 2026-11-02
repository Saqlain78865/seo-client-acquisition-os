import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { logger } from "../log";
import { notify } from "../notifications";
import { logActivity } from "../activity";
import { getFile, putFile } from "../storage";
import { launchChromium } from "../crawler/browser";
import { assertPublicHost, assertUrlShape } from "../crawler/network-guard";
import { runnerOptions } from "../audit/runner";
import { renderAuditVideo, type VideoScript } from "./render-in-page";

/**
 * Personal audit video: a one-minute MP4 that walks through the prospect's website and its biggest
 * problems (from the audit and its screenshots), ending with the consultant's contact details. It
 * is made in a headless browser (canvas + WebCodecs H.264), so no extra software is needed.
 */

export class AuditVideoError extends Error {}

const log = logger("audit-video");
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const dataUri = (b: Buffer, type = "image/jpeg") => `data:${type};base64,${b.toString("base64")}`;
const short = (t: string | null | undefined, n: number) => {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > n * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
};

export async function requestAuditVideo(workspaceId: string, prospectId: string) {
  const audit = await db.websiteAudit.findFirst({ where: { workspaceId, prospectId, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!audit) throw new AuditVideoError("Run a website audit for this prospect first — the video shows its findings.");
  const busy = await db.auditVideo.findFirst({ where: { prospectId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (busy) return busy;
  const video = await db.auditVideo.create({ data: { workspaceId, prospectId, auditId: audit.id } });
  const { enqueueJob } = await import("../jobs");
  await enqueueJob(workspaceId, "audit.video", { videoId: video.id }, { maxAttempts: 1 });
  return video;
}

async function fullPageShot(url: string) {
  const { chromium } = await import("playwright");
  const browser = await launchChromium(chromium, { headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const guard = { allowPrivateNetworks: runnerOptions.allowPrivateNetworks };
    await assertPublicHost(assertUrlShape(url, guard).hostname, guard);
    await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    await page.waitForTimeout(1500);
    const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 3600);
    return await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y: 0, width: 1280, height }, fullPage: true });
  } finally {
    await browser.close();
  }
}

export async function buildVideoScript(videoId: string): Promise<VideoScript & { workspaceId: string; prospectId: string }> {
  const v = await db.auditVideo.findUnique({ where: { id: videoId }, include: { prospect: true } });
  if (!v) throw new AuditVideoError("Video not found.");
  const audit = await db.websiteAudit.findUnique({
    where: { id: v.auditId },
    include: { findings: { where: { resolutionStatus: { not: "DISMISSED" }, includeInProposal: true } }, screenshots: true },
  });
  if (!audit) throw new AuditVideoError("The audit was deleted.");
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: v.workspaceId } });
  const findings = audit.findings
    .filter((f) => SEVERITY_ORDER.includes(f.severity))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.priority - a.priority);
  const top = findings.slice(0, 4);
  const shot = async (key: string | undefined) => (key ? dataUri(await getFile(key)) : null);
  const findingShot = (ruleId: string) => audit.screenshots.find((s) => s.kind === "FINDING" && s.ruleId === ruleId)?.storageKey;
  let full: string | null = null;
  try {
    full = dataUri(await fullPageShot(audit.normalizedUrl));
  } catch (e) {
    log.warn("full-page screenshot failed; the saved homepage shot is used", { videoId, reason: (e as Error).message });
  }
  const domain = v.prospect.domain;
  const preparedBy = settings?.companyName || settings?.consultantName || "Your SEO consultant";
  return {
    workspaceId: v.workspaceId,
    prospectId: v.prospectId,
    width: 1280,
    height: 720,
    fps: 30,
    brand: settings?.brandColor || "#4f46e5",
    business: v.prospect.businessName,
    domain,
    preparedBy: settings?.consultantName && settings?.companyName ? `${settings.consultantName}, ${settings.companyName}` : preparedBy,
    dateLabel: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    images: {
      full,
      desktop: await shot(audit.screenshots.find((s) => s.kind === "HOMEPAGE_DESKTOP")?.storageKey).catch(() => null),
      mobile: await shot(audit.screenshots.find((s) => s.kind === "HOMEPAGE_MOBILE")?.storageKey).catch(() => null),
      findings: await Promise.all(top.map((f) => shot(findingShot(f.ruleId)).catch(() => null))),
    },
    issues: top.map((f) => ({ title: short(f.title, 110), impact: short(f.businessImpact || f.observedFacts, 200), fix: short(f.recommendation, 150), severity: f.severity })),
    counts: {
      critical: findings.filter((f) => f.severity === "CRITICAL").length,
      high: findings.filter((f) => f.severity === "HIGH").length,
      medium: findings.filter((f) => f.severity === "MEDIUM").length,
      total: findings.length,
    },
    contact: [settings?.companyPhone, settings?.consultantWhatsApp && settings.consultantWhatsApp !== settings.companyPhone ? `WhatsApp ${settings.consultantWhatsApp}` : null, settings?.companyEmail, settings?.companyWebsite?.replace(/^https?:\/\//, "")].filter((x): x is string => !!x),
  };
}

/** Renders the MP4 in a headless browser page and saves it. */
export async function renderVideoFile(script: VideoScript) {
  const muxerPath = path.join(process.cwd(), "node_modules", "mp4-muxer", "build", "mp4-muxer.js");
  const muxer = await fs.readFile(muxerPath, "utf8").catch(() => {
    throw new AuditVideoError("The video encoder file is missing (mp4-muxer). Reinstall the app.");
  });
  const { chromium } = await import("playwright");
  const browser = await launchChromium(chromium, { headless: true });
  try {
    const page = await browser.newPage();
    // WebCodecs needs a secure page: a made-up https address served from here, never the network.
    await page.route("**/*", (r) => (r.request().url().startsWith("https://video.leadlift.local/") ? r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }) : r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    await page.goto("https://video.leadlift.local/");
    await page.addScriptTag({ content: muxer });
    const ok = await page.evaluate(() => typeof VideoEncoder === "function" && "Mp4Muxer" in window);
    if (!ok) throw new AuditVideoError("This browser cannot encode video (WebCodecs is missing).");
    const out = await page.evaluate(renderAuditVideo, script);
    return { buffer: Buffer.from(out.base64, "base64"), seconds: out.seconds };
  } finally {
    await browser.close();
  }
}

export async function generateAuditVideo(videoId: string) {
  const v = await db.auditVideo.update({ where: { id: videoId }, data: { status: "RUNNING", error: null } });
  try {
    const script = await buildVideoScript(videoId);
    const { buffer, seconds } = await renderVideoFile(script);
    const key = `videos/${v.prospectId}/${v.id}.mp4`;
    await putFile(key, buffer);
    await db.auditVideo.update({ where: { id: v.id }, data: { status: "READY", storageKey: key, seconds } });
    await logActivity({ workspaceId: v.workspaceId, prospectId: v.prospectId, type: "video.ready", message: `Audit video ready (${seconds}s, ${(buffer.length / 1048576).toFixed(1)} MB)` });
    await notify({ workspaceId: v.workspaceId, title: `Audit video ready: ${script.business}`, body: `${seconds} seconds — download it and send it on WhatsApp or by email.`, link: `/prospects/${v.prospectId}#video` });
  } catch (e) {
    const message = e instanceof AuditVideoError ? e.message : `The video could not be made: ${(e as Error).message.split("\n")[0]}`;
    await db.auditVideo.update({ where: { id: v.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    log.warn("audit video failed", { videoId, reason: (e as Error).message });
    throw e;
  }
}
