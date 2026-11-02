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
import { SAMPLE_RATE, speakLines, type Voice } from "./tts";

/**
 * Personal audit video: an MP4 that walks through the prospect's website and every problem the
 * audit found, with a voice-over that explains each one and ends with the consultant's contact
 * details. It is made in a headless browser (canvas + WebCodecs), with the voices built into
 * Windows, so no extra software or paid service is needed. Its length follows the number of issues.
 */

export class AuditVideoError extends Error {}

const log = logger("audit-video");
const DETAILED = ["CRITICAL", "HIGH", "MEDIUM"];
/** Scenes for one issue each, at most; anything beyond is listed with the smaller fixes. */
const MAX_DETAILED = 40;
const MINOR_PER_SCREEN = 6;
const dataUri = (b: Buffer, type = "image/jpeg") => `data:${type};base64,${b.toString("base64")}`;
const short = (t: string | null | undefined, n: number) => {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > n * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sentence = (t: string) => (t && !/[.!?…]$/.test(t) ? `${t}.` : t).replace(/…$/, ".");

export async function requestAuditVideo(workspaceId: string, prospectId: string, voice: Voice = "female") {
  const audit = await db.websiteAudit.findFirst({ where: { workspaceId, prospectId, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!audit) throw new AuditVideoError("Run a website audit for this prospect first — the video shows its findings.");
  const busy = await db.auditVideo.findFirst({ where: { prospectId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (busy) return busy;
  const video = await db.auditVideo.create({ data: { workspaceId, prospectId, auditId: audit.id } });
  const { enqueueJob } = await import("../jobs");
  await enqueueJob(workspaceId, "audit.video", { videoId: video.id, voice }, { maxAttempts: 1 });
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

/** What the voice says over each scene, in the order the scenes are drawn. */
export function narration(s: Pick<VideoScript, "business" | "domain" | "preparedBy" | "issues" | "minor" | "counts" | "contact" | "images">) {
  const domain = s.domain.replace(/^www\./, "").replace(/\./g, " dot ");
  const lines: string[] = [
    `Hello, ${s.business} team. This is a short, free review of your website, ${domain}, prepared by ${s.preparedBy}. We found ${plural(s.counts.total, "issue")} that make it harder for customers to find you on Google and to contact you. Let me walk you through ${s.counts.total === 1 ? "it" : "each one"}.`,
  ];
  if (s.images.full || s.images.desktop) lines.push("This is your homepage today, as your visitors see it.");
  if (s.images.mobile) lines.push("And this is how it looks on a phone, which is how many of your customers will find you.");
  s.issues.forEach((i, n) => lines.push(`Issue ${n + 1} of ${s.issues.length}. ${sentence(i.title)} ${sentence(i.impact)} How we would fix it: ${sentence(i.fix)}`.trim()));
  const fixes = s.minor.flat().length;
  s.minor.forEach((_, n) => lines.push(n === 0 ? `We also found ${plural(fixes, "smaller fix")}, listed on screen. Each one is quick to put right.` : "And a few more smaller fixes."));
  const parts = [
    s.counts.critical ? `${s.counts.critical} critical` : "",
    s.counts.high ? `${s.counts.high} high-impact` : "",
    s.counts.medium ? `${s.counts.medium} medium` : "",
    s.counts.low ? `${s.counts.low} smaller` : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  lines.push(`${list ? `To sum up: ${list} ${s.counts.total === 1 ? "issue" : "issues"}. ` : ""}The good news is that every one of them can be fixed, and fixing them helps more customers find you and get in touch.`);
  lines.push(`If you would like us to fix these for you, simply reply to this message${s.contact[0] ? `, or call ${s.contact[0].replace(/^WhatsApp /, "")}` : ""}. We will send you the full report, free and with no obligation. Thank you for watching.`);
  return lines;
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
  const order = [...DETAILED, "LOW"];
  const findings = audit.findings.filter((f) => order.includes(f.severity)).sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || b.priority - a.priority);
  // Every critical, high and medium issue gets its own scene; low ones are listed together.
  const detailed = findings.filter((f) => DETAILED.includes(f.severity)).slice(0, MAX_DETAILED);
  const listed = [...findings.filter((f) => DETAILED.includes(f.severity)).slice(MAX_DETAILED), ...findings.filter((f) => f.severity === "LOW")].map((f) => short(f.title, 90));
  const minor: string[][] = [];
  for (let i = 0; i < listed.length; i += MINOR_PER_SCREEN) minor.push(listed.slice(i, i + MINOR_PER_SCREEN));
  const shot = async (key: string | undefined) => (key ? dataUri(await getFile(key)) : null);
  const findingShot = (ruleId: string) => audit.screenshots.find((s) => s.kind === "FINDING" && s.ruleId === ruleId)?.storageKey;
  let full: string | null = null;
  try {
    full = dataUri(await fullPageShot(audit.normalizedUrl));
  } catch (e) {
    log.warn("full-page screenshot failed; the saved homepage shot is used", { videoId, reason: (e as Error).message });
  }
  const company = settings?.companyName || settings?.consultantName || "Your SEO consultant";
  return {
    workspaceId: v.workspaceId,
    prospectId: v.prospectId,
    width: 1280,
    height: 720,
    fps: 30,
    brand: settings?.brandColor || "#4f46e5",
    business: v.prospect.businessName,
    domain: v.prospect.domain,
    preparedBy: settings?.consultantName && settings?.companyName ? `${settings.consultantName}, ${settings.companyName}` : company,
    dateLabel: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    images: {
      full,
      desktop: await shot(audit.screenshots.find((s) => s.kind === "HOMEPAGE_DESKTOP")?.storageKey).catch(() => null),
      mobile: await shot(audit.screenshots.find((s) => s.kind === "HOMEPAGE_MOBILE")?.storageKey).catch(() => null),
      findings: await Promise.all(detailed.map((f) => shot(findingShot(f.ruleId)).catch(() => null))),
    },
    issues: detailed.map((f) => ({ title: short(f.title, 110), impact: short(f.businessImpact || f.observedFacts, 220), fix: short(f.recommendation, 170), severity: f.severity })),
    minor,
    counts: {
      critical: findings.filter((f) => f.severity === "CRITICAL").length,
      high: findings.filter((f) => f.severity === "HIGH").length,
      medium: findings.filter((f) => f.severity === "MEDIUM").length,
      low: findings.filter((f) => f.severity === "LOW").length,
      total: findings.length,
    },
    contact: [settings?.companyPhone, settings?.consultantWhatsApp && settings.consultantWhatsApp !== settings.companyPhone ? `WhatsApp ${settings.consultantWhatsApp}` : null, settings?.companyEmail, settings?.companyWebsite?.replace(/^https?:\/\//, "")].filter((x): x is string => !!x),
    durations: null,
    audio: false,
  };
}

/** Speaks the narration and lays it on one track: each line starts just after its scene begins. */
export async function voiceOver(script: VideoScript, voice: Voice) {
  const lines = narration(script);
  const spoken = await speakLines(lines, voice);
  if (!spoken) return null;
  const lead = 0.4;
  const defaults = [4, ...(script.images.full || script.images.desktop ? [script.images.full ? 9 : 6] : []), ...(script.images.mobile ? [5] : []), ...script.issues.map(() => 6.5), ...script.minor.map(() => 6), 5, 6];
  const durations = spoken.map((pcm, i) => Math.max(defaults[i] ?? 5, lead + pcm.length / SAMPLE_RATE + 0.7));
  const total = durations.reduce((a, b) => a + b, 0);
  const track = new Int16Array(Math.ceil(total * SAMPLE_RATE) + SAMPLE_RATE);
  let at = 0;
  spoken.forEach((pcm, i) => {
    track.set(pcm.subarray(0, Math.max(0, track.length - Math.round((at + lead) * SAMPLE_RATE))), Math.round((at + lead) * SAMPLE_RATE));
    at += durations[i];
  });
  return { durations, track };
}

/** Renders the MP4 in a headless browser page; files go in and out in parts to keep messages small. */
export async function renderVideoFile(script: VideoScript, track: Int16Array | null = null) {
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
    const ok = await page.evaluate(() => typeof VideoEncoder === "function" && typeof AudioEncoder === "function" && "Mp4Muxer" in window);
    if (!ok) throw new AuditVideoError("This browser cannot encode video (WebCodecs is missing).");
    if (track) {
      const bytes = Buffer.from(track.buffer, track.byteOffset, track.byteLength);
      await page.evaluate((n) => ((window as unknown as { __pcmParts: string[]; __pcmBytes: number }).__pcmParts = []) && ((window as unknown as { __pcmBytes: number }).__pcmBytes = n), bytes.length);
      for (let i = 0; i < bytes.length; i += 4 << 20) await page.evaluate((b64) => (window as unknown as { __pcmParts: string[] }).__pcmParts.push(b64), bytes.subarray(i, i + (4 << 20)).toString("base64"));
      await page.evaluate(() => {
        const w = window as unknown as { __pcmParts: string[]; __pcmBytes: number; __pcm: Int16Array };
        const all = new Uint8Array(w.__pcmBytes);
        let at = 0;
        for (const part of w.__pcmParts) {
          const bin = atob(part);
          for (let i = 0; i < bin.length; i++) all[at++] = bin.charCodeAt(i);
        }
        w.__pcm = new Int16Array(all.buffer);
        w.__pcmParts = [];
      });
    }
    const out = await page.evaluate(renderAuditVideo, { ...script, audio: !!track });
    const parts: Buffer[] = [];
    for (let i = 0; i < out.bytes; i += 4 << 20) {
      const b64 = await page.evaluate(
        ([from, to]) => {
          const bytes = (window as unknown as { __mp4: Uint8Array }).__mp4.subarray(from, to);
          let bin = "";
          for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
          return btoa(bin);
        },
        [i, Math.min(i + (4 << 20), out.bytes)] as const,
      );
      parts.push(Buffer.from(b64, "base64"));
    }
    return { buffer: Buffer.concat(parts), seconds: out.seconds };
  } finally {
    await browser.close();
  }
}

export async function generateAuditVideo(videoId: string, voice: Voice = "female") {
  const v = await db.auditVideo.update({ where: { id: videoId }, data: { status: "RUNNING", error: null } });
  try {
    const script = await buildVideoScript(videoId);
    const voiced = await voiceOver(script, voice).catch((e) => {
      // The video is still useful without a voice; the reason is logged.
      log.warn("voice-over failed; the video is made without it", { videoId, reason: (e as Error).message });
      return null;
    });
    const { buffer, seconds } = await renderVideoFile({ ...script, durations: voiced?.durations ?? null }, voiced?.track ?? null);
    const key = `videos/${v.prospectId}/${v.id}.mp4`;
    await putFile(key, buffer);
    await db.auditVideo.update({ where: { id: v.id }, data: { status: "READY", storageKey: key, seconds } });
    const minutes = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    await logActivity({ workspaceId: v.workspaceId, prospectId: v.prospectId, type: "video.ready", message: `Audit video ready (${minutes}, ${script.issues.length + script.minor.flat().length} issues${voiced ? ", with voice-over" : ""}, ${(buffer.length / 1048576).toFixed(1)} MB)` });
    await notify({ workspaceId: v.workspaceId, title: `Audit video ready: ${script.business}`, body: `${minutes} minutes — download it and send it on WhatsApp or by email.`, link: `/prospects/${v.prospectId}#video` });
  } catch (e) {
    const message = e instanceof AuditVideoError ? e.message : `The video could not be made: ${(e as Error).message.split("\n")[0]}`;
    await db.auditVideo.update({ where: { id: v.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    log.warn("audit video failed", { videoId, reason: (e as Error).message });
    throw e;
  }
}
