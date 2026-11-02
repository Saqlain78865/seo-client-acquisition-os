import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { saveCredentials } from "@/lib/integrations";
import { checkReplies, emailOf, handleReply, unescapeHtml } from "@/lib/reply-detection";
import { scoreLead, refreshLeadScores } from "@/lib/lead-score";
import { eventFor, syncCalendar } from "@/lib/calendar-sync";
import { findCannibalization, findDecay, lastMonths } from "@/lib/gsc-analysis";
import { checkExternal, internalIssues } from "@/lib/link-audit";
import { agreementHtml, agreementData } from "@/lib/proposals/agreement";
import { renderVideoFile } from "@/lib/video/audit-video";
import type { CrawledRecord } from "@/lib/crawler/crawl";

async function workspace(name: string) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  await saveCredentials(ws.id, "GOOGLE_OAUTH_APP", { secret: { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" } });
  return { workspaceId: ws.id, userId: user.id };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = (url: string) => (url.startsWith("https://oauth2.googleapis.com/token") ? json({ access_token: "t", expires_in: 3600 }) : null);

async function prospectWithEmail(workspaceId: string, email: string, status = "PROPOSAL_SENT") {
  return db.prospect.create({ data: { workspaceId, businessName: "Karachi Smiles", websiteUrl: "https://smiles.example/", domain: "smiles.example", status, contacts: { create: { type: "EMAIL", value: email } } } });
}

describe("Gmail reply detection", () => {
  it("reads sender addresses and Gmail snippets", () => {
    expect(emailOf("Ali Khan <Ali@Smiles.Example>")).toBe("ali@smiles.example");
    expect(emailOf("ali@smiles.example")).toBe("ali@smiles.example");
    expect(unescapeHtml("Yes, let&#39;s talk &amp; meet")).toBe("Yes, let's talk & meet");
  });

  it("finds a prospect's reply, stops their follow-ups and moves the deal to Replied — once", async () => {
    const { workspaceId } = await workspace("reply");
    const p = await prospectWithEmail(workspaceId, "ali@smiles.example");
    await db.followUp.create({ data: { workspaceId, prospectId: p.id, type: "PROPOSAL_REMINDER", dueAt: new Date(Date.now() + 86400_000) } });
    await saveCredentials(workspaceId, "GMAIL_REPLIES", { secret: { refreshToken: "r" }, accountLabel: "me@example.com" });
    let query = "";
    const fake = (async (url: string) => {
      const t = token(url);
      if (t) return t;
      if (url.includes("/messages?")) {
        query = decodeURIComponent(url);
        return json({ messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }] });
      }
      if (url.includes("/messages/m1")) return json({ id: "m1", threadId: "t1", snippet: "Yes, let&#39;s talk", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Ali <ALI@smiles.example>" }, { name: "Subject", value: "Re: SEO proposal" }] } });
      return json({ id: "m2", threadId: "t2", snippet: "Newsletter", payload: { headers: [{ name: "From", value: "news@shop.example" }] } });
    }) as unknown as typeof fetch;

    expect(await checkReplies(workspaceId, fake)).toBe(1);
    expect(query).toContain("-from:me");
    const after = await db.prospect.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe("REPLIED");
    expect(after.repliedAt).not.toBeNull();
    expect(await db.followUp.count({ where: { prospectId: p.id, status: "PENDING" } })).toBe(0);
    expect(await db.pipelineStatus.count({ where: { workspaceId, key: "REPLIED" } })).toBe(1);
    expect((await db.gmailReply.findFirstOrThrow({ where: { prospectId: p.id } })).snippet).toBe("Yes, let's talk");
    // The same message is never handled twice.
    expect(await checkReplies(workspaceId, fake)).toBe(0);
    expect(await db.notification.count({ where: { workspaceId, title: { contains: "replied" } } })).toBe(1);
  });

  it("leaves later stages alone", async () => {
    const { workspaceId } = await workspace("reply2");
    const p = await prospectWithEmail(workspaceId, "b@x.example", "NEGOTIATION");
    await handleReply(workspaceId, p.id, { messageId: "z", fromEmail: "b@x.example", receivedAt: new Date() });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("NEGOTIATION");
  });
});

describe("lead score", () => {
  const base = { status: "AUDIT_COMPLETED", doNotContact: false, websiteUrl: "https://a.example/", critical: 0, high: 0, audited: true, rating: null, reviewCount: null, hasProfile: false, reachable: false, repliedAt: null, proposalViews: 0, proposalSent: false, lastActivityAt: new Date() };

  it("adds need and warmth, with a reason for every point", () => {
    const hot = scoreLead({ ...base, critical: 2, high: 3, hasProfile: true, reviewCount: 9, rating: 3.6, reachable: true, repliedAt: new Date(), proposalViews: 2, proposalSent: true });
    // 21 (2 critical, 3 high) + 8 + 7 + 10 + 25 + 11 (2 views) + 5
    expect(hot.score).toBe(87);
    expect(hot.reasons[0]).toBe("+25 Replied in the last 30 days");
    expect(scoreLead({ ...base, websiteUrl: "https://www.google.com/maps/search/?api=1&query=x", reachable: true }).score).toBe(30);
    expect(scoreLead({ ...base, status: "WON", critical: 5 })).toEqual({ score: 0, reasons: ["Already a client"] });
    expect(scoreLead({ ...base, doNotContact: true, critical: 5 }).score).toBe(0);
    const cold = scoreLead({ ...base, high: 1, lastActivityAt: new Date(Date.now() - 90 * 86400_000) });
    expect(cold).toEqual({ score: 0, reasons: ["+3 0 critical and 1 high website issues", "-10 No activity for 2 months"] });
  });

  it("stores scores for the workspace's prospects", async () => {
    const { workspaceId } = await workspace("score");
    const p = await prospectWithEmail(workspaceId, "c@x.example");
    await refreshLeadScores(workspaceId);
    const after = await db.prospect.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.leadScore).toBe(10);
    expect(after.leadScoreReasons).toEqual(["+10 Email, phone or WhatsApp on file"]);
  });
});

describe("Google Calendar follow-ups", () => {
  it("adds pending follow-ups as events with a reminder and removes finished ones", async () => {
    const { workspaceId } = await workspace("cal");
    const p = await prospectWithEmail(workspaceId, "d@x.example");
    const f = await db.followUp.create({ data: { workspaceId, prospectId: p.id, type: "PROPOSAL_REMINDER", dueAt: new Date(Date.now() + 2 * 86400_000), note: "Ask about the proposal" } });
    expect(await syncCalendar(workspaceId)).toBeNull();
    await saveCredentials(workspaceId, "GOOGLE_CALENDAR", { secret: { refreshToken: "r" }, accountLabel: "me@example.com" });
    const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const t = token(url);
      if (t) return t;
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return json({ id: "ev1" });
    }) as unknown as typeof fetch;
    expect(await syncCalendar(workspaceId, fake)).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(calls[0].body).toMatchObject({ summary: "Proposal follow-up: Karachi Smiles", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] } });
    expect((await db.followUp.findUniqueOrThrow({ where: { id: f.id } })).calendarEventId).toBe("ev1");
    await db.followUp.update({ where: { id: f.id }, data: { status: "DONE" } });
    expect(await syncCalendar(workspaceId, fake, new Date(Date.now() + 3600_000))).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect((await db.followUp.findUniqueOrThrow({ where: { id: f.id } })).calendarEventId).toBeNull();
    expect(eventFor({ type: "CUSTOM", dueAt: new Date("2026-11-05T10:00:00Z"), note: null, prospect: { id: "x", businessName: "B", domain: "b.example" } }).end).toEqual({ dateTime: "2026-11-05T10:30:00.000Z" });
  });
});

describe("Search Console analyses", () => {
  it("finds searches where two pages compete", () => {
    const row = (q: string, page: string, impressions: number, position = 8) => ({ keys: [q, page], clicks: 1, impressions, position });
    const r = findCannibalization([row("pad thai nyc", "https://x/menu", 300), row("pad thai nyc", "https://x/blog/pad-thai", 200), row("pad thai nyc", "https://x/", 10), row("zoob zib", "https://x/", 900), row("thai", "https://x/a", 20), row("thai", "https://x/b", 20)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ query: "pad thai nyc", impressions: 510 });
    expect(r[0].pages.map((p) => [p.page, Math.round(p.share * 100)])).toEqual([
      ["https://x/menu", 59],
      ["https://x/blog/pad-thai", 39],
    ]);
  });

  it("finds pages losing clicks month after month", () => {
    expect(lastMonths(new Date("2026-11-02T00:00:00Z"), 2)).toEqual([
      { month: "2026-09", start: "2026-09-01", end: "2026-09-30" },
      { month: "2026-10", start: "2026-10-01", end: "2026-10-31" },
    ]);
    const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
    const r = findDecay(
      new Map([
        ["/falling", [100, 80, 60, 40]],
        ["/growing", [10, 20, 40, 80]],
        ["/blip", [100, 40, 90, 95]],
        ["/small", [10, 5, 3, 1]],
      ]),
      months,
    );
    expect(r.map((d) => [d.page, d.lost, Math.round(d.drop * 100)])).toEqual([["/falling", 60, 60]]);
  });
});

describe("links, redirects and canonicals", () => {
  const rec = (url: string, extra: Partial<CrawledRecord> & { links?: string[]; ext?: string[]; canonical?: string | null } = {}): CrawledRecord =>
    ({
      url,
      finalUrl: extra.finalUrl ?? url,
      status: extra.status === undefined ? 200 : extra.status,
      redirectChain: extra.redirectChain ?? [],
      error: extra.error ?? null,
      page: { internalLinks: (extra.links ?? []).map((u) => ({ url: u, text: "", nofollow: false })), externalLinks: (extra.ext ?? []).map((u) => ({ url: u, text: "", nofollow: false })), canonical: extra.canonical ?? null },
    }) as unknown as CrawledRecord;

  it("finds broken pages, redirect chains, links to redirects and wrong canonicals", async () => {
    const o = "https://site.example";
    const pages = [
      rec(`${o}/`, { links: [`${o}/old`, `${o}/gone`, `${o}/chain`], ext: ["https://dead.example/x", "https://linkedin.com/in/me"] }),
      rec(`${o}/old`, { finalUrl: `${o}/new`, redirectChain: [{ url: `${o}/old`, status: 301 }] }),
      rec(`${o}/gone`, { status: 404 }),
      rec(`${o}/chain`, { finalUrl: `${o}/c3`, redirectChain: [{ url: `${o}/chain`, status: 301 }, { url: `${o}/c2`, status: 302 }] }),
      rec(`${o}/dup`, { canonical: "https://other.example/dup" }),
      rec(`${o}/dup2`, { canonical: `${o}/gone` }),
    ];
    const r = internalIssues(pages, o);
    expect(r.broken.map((b) => [b.url, b.status, b.foundOn])).toEqual([[`${o}/gone`, 404, [`${o}/`]]]);
    expect(r.redirects.map((x) => [x.kind, x.url])).toEqual([
      ["LINKED_REDIRECT", `${o}/old`],
      ["CHAIN", `${o}/chain`],
    ]);
    expect(r.canonicals.map((c) => c.problem)).toEqual(["Points to another website", "Points to a page that returns 404"]);
    const ext = await checkExternal(
      new Map([
        ["https://dead.example/x", new Set([`${o}/`])],
        ["https://linkedin.com/in/me", new Set([`${o}/`])],
      ]),
      async (u) => (u.includes("dead") ? { status: null, error: "getaddrinfo ENOTFOUND" } : { status: 999, error: null }),
    );
    expect(ext.map((b) => [b.url, b.blockedBots])).toEqual([
      ["https://dead.example/x", false],
      ["https://linkedin.com/in/me", true],
    ]);
  });
});

describe("service agreement", () => {
  it("is made from the accepted proposal with the client's signature", async () => {
    const { workspaceId } = await workspace("agr");
    const p = await prospectWithEmail(workspaceId, "e@x.example");
    const proposal = await db.proposal.create({ data: { workspaceId, prospectId: p.id, title: "SEO plan", status: "ACCEPTED", acceptedAt: new Date("2026-11-01T10:00:00Z"), shareVersion: 1 } });
    await db.proposalVersion.create({ data: { proposalId: proposal.id, version: 1, currency: "USD", monthlyPrice: 400, setupFee: 150, durationMonths: 6, services: ["TECHNICAL", "LOCAL"], deliverables: [{ title: "4 articles a month", detail: "" }], branding: { companyName: "LeadLift SEO", consultantName: "Saqlain", email: "hi@leadlift.example", phone: null, website: null, whatsapp: null, logoDataUri: null } } });
    const sig = "data:image/png;base64,iVBORw0KGgo=";
    await db.proposalResponse.create({ data: { proposalId: proposal.id, kind: "ACCEPT", name: "Ali Khan", signature: sig, version: 1 } });
    const data = await agreementData(workspaceId, proposal.id);
    expect(data).toMatchObject({ services: ["Technical SEO", "Local SEO"], monthlyPrice: 400, durationMonths: 6, acceptance: { name: "Ali Khan" } });
    const html = agreementHtml(data);
    expect(html).toContain("$400.00");
    expect(html).toContain("runs for 6 months");
    expect(html).toContain(`<img src="${sig}"`);
    expect(html).toContain("no specific position or number of visitors can be guaranteed");
    await expect(agreementData("other", proposal.id)).rejects.toThrow(/not found/);
  });
});

describe("audit video", () => {
  it("encodes a real H.264 MP4 in the browser", async () => {
    const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { buffer, seconds } = await renderVideoFile({
      width: 640,
      height: 360,
      fps: 10,
      brand: "#4f46e5",
      business: "Karachi Smiles Dental",
      domain: "smiles.example",
      preparedBy: "LeadLift SEO",
      dateLabel: "2 November 2026",
      images: { full: px, desktop: px, mobile: px, findings: [px] },
      issues: [{ title: "The page title is missing", impact: "Google shows a guess instead.", fix: "Write a clear title.", severity: "CRITICAL" }],
      counts: { critical: 1, high: 0, medium: 0, total: 1 },
      contact: ["+92 300 0000000"],
    });
    // Intro 4 + scroll 9 + phone 5 + one problem 6.5 + summary 5 + contact 6.
    expect(seconds).toBe(36);
    // An MP4 starts with an "ftyp" box and holds an H.264 (avc1) track.
    expect(buffer.subarray(4, 8).toString()).toBe("ftyp");
    expect(buffer.includes(Buffer.from("avc1"))).toBe(true);
    expect(buffer.length).toBeGreaterThan(20_000);
  }, 180_000);
});

describe("Google Drive backup", () => {
  it("uploads a gzipped copy of the database into its folder and keeps the newest 14", async () => {
    const { workspaceId } = await workspace("drive");
    const { backupToDrive } = await import("@/lib/drive-backup");
    await expect(backupToDrive(workspaceId)).rejects.toThrow(/Connect Google Drive/);
    await saveCredentials(workspaceId, "GOOGLE_DRIVE", { secret: { refreshToken: "r" }, accountLabel: "me@example.com" });
    const deleted: string[] = [];
    let upload: Buffer | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      const t = token(url);
      if (t) return t;
      if (url.startsWith("https://www.googleapis.com/upload/")) {
        upload = Buffer.from(init!.body as Uint8Array);
        return json({ id: "f-new", name: "x" });
      }
      if (init?.method === "DELETE") {
        deleted.push(url.split("/").pop()!);
        return new Response(null, { status: 204 });
      }
      if (url.includes("mimeType")) return json({ files: [] });
      if (init?.method === "POST") return json({ id: "folder1" });
      // The folder's files, newest first: 16 backups.
      return json({ files: Array.from({ length: 16 }, (_, i) => ({ id: `f${i}`, name: `leadlift-${i}.db.gz` })) });
    }) as unknown as typeof fetch;
    const r = await backupToDrive(workspaceId, fake, new Date("2026-11-02T03:00:00Z"));
    expect(r.name).toBe("leadlift-2026-11-02-03-00.db.gz");
    expect(r.removed).toBe(2);
    expect(deleted).toEqual(["f14", "f15"]);
    const body = upload!;
    expect(body.toString("latin1")).toContain('"parents":["folder1"]');
    // The file part is gzip (1f 8b) and holds a SQLite database.
    const start = body.indexOf(Buffer.from([0x1f, 0x8b]));
    const { gunzipSync } = await import("node:zlib");
    const end = body.lastIndexOf(Buffer.from("\r\n--"));
    expect(gunzipSync(body.subarray(start, end)).subarray(0, 15).toString()).toBe("SQLite format 3");
    const conn = await db.integrationConnection.findFirstOrThrow({ where: { workspaceId, provider: "GOOGLE_DRIVE" } });
    expect((conn.config as { lastBackupName: string }).lastBackupName).toBe(r.name);
  }, 60_000);
});

describe("audit video from a real audit", () => {
  it("films the website and the audit's top problems into an MP4", async () => {
    const http = await import("node:http");
    const { runnerOptions } = await import("@/lib/audit/runner");
    const server = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body style="margin:0"><h1 style="height:900px;background:#fde68a">Karachi Smiles</h1><p style="height:900px;background:#bfdbfe">Services</p></body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    runnerOptions.allowPrivateNetworks = true;
    try {
      const { workspaceId } = await workspace("video");
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      const p = await db.prospect.create({ data: { workspaceId, businessName: "Karachi Smiles", websiteUrl: url, domain: "127.0.0.1" } });
      const audit = await db.websiteAudit.create({ data: { workspaceId, prospectId: p.id, inputUrl: url, normalizedUrl: url, status: "COMPLETED" } });
      await db.auditFinding.createMany({
        data: [
          { auditId: audit.id, ruleId: "a", category: "Technical", title: "Missing page title", severity: "CRITICAL", evidenceStatus: "CONFIRMED", affectedUrls: [url], observedFacts: "No <title>.", recommendation: "Add a title." },
          { auditId: audit.id, ruleId: "b", category: "Local SEO", title: "No phone number on the home page", severity: "HIGH", evidenceStatus: "CONFIRMED", affectedUrls: [url], observedFacts: "No tel: link.", recommendation: "Add the phone number." },
        ],
      });
      const { requestAuditVideo, generateAuditVideo } = await import("@/lib/video/audit-video");
      const v = await requestAuditVideo(workspaceId, p.id);
      await generateAuditVideo(v.id);
      const done = await db.auditVideo.findUniqueOrThrow({ where: { id: v.id } });
      // Intro 4 + scroll 9 + two problems 13 + summary 5 + contact 6 (no phone screenshot in this audit).
      expect(done).toMatchObject({ status: "READY", seconds: 37 });
      const { getFile } = await import("@/lib/storage");
      const mp4 = await getFile(done.storageKey!);
      expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
      expect(await db.notification.count({ where: { workspaceId, title: { contains: "Audit video ready" } } })).toBe(1);
    } finally {
      runnerOptions.allowPrivateNetworks = false;
      server.close();
    }
  }, 300_000);
});
