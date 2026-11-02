// Adds the newer features to the demo workspace for the product tour: My Websites with Search
// Console data, keyword tracking, alerts, indexing, competitor watch, a content calendar and the
// report email; lead scores, technology/email checks, a reply, a signed agreement, an audit video
// and an auto-send campaign. Fictional data only (see fake-google.mjs).
import { db } from "../../src/lib/db.ts";
import { saveCredentials } from "../../src/lib/integrations.ts";
import { createWebsite } from "../../src/lib/websites.ts";
import { addKeywords, syncPositions } from "../../src/lib/rank-tracking.ts";
import { raiseAlert } from "../../src/lib/site-alerts.ts";
import { addWork } from "../../src/lib/work-log.ts";
import { runIndexCheck } from "../../src/lib/site-health.ts";
import { createContentPlan, setPlanItemStatus } from "../../src/lib/content-calendar.ts";
import { saveReportSchedule } from "../../src/lib/report-delivery.ts";
import { refreshLeadScores } from "../../src/lib/lead-score.ts";
import { detectStack } from "../../src/lib/tech-stack.ts";
import { checkEmailHealth, type Resolver } from "../../src/lib/email-health.ts";
import { handleReply } from "../../src/lib/reply-detection.ts";
import { generateAuditVideo } from "../../src/lib/video/audit-video.ts";
import { monthKey, shiftMonth } from "../../src/lib/client-work.ts";
import { fakeGoogle } from "./fake-google.mjs";
import { chromium } from "playwright";

const DAY = 86400_000;
const fakeFetch = (async (url: string, init?: RequestInit) => (fakeGoogle(url, init) as Response | null) ?? fetch(url, init)) as unknown as typeof fetch;

export async function extend(o: { wsId: string; userId: string; sky: string; smile: string; movers: string; smileProposal: string; moversProposal: string }) {
  const { wsId, userId } = o;
  const now = new Date();

  // ── Connections (fictional tokens; the tour never sends anything) ──
  await saveCredentials(wsId, "GOOGLE_OAUTH_APP", { secret: { clientId: "1234567890-demo.apps.googleusercontent.com", clientSecret: "demo" }, accountLabel: "LeadLift (demo)" });
  for (const p of ["SEARCH_CONSOLE", "GMAIL_OAUTH", "GMAIL_REPLIES", "GOOGLE_CALENDAR"] as const) await saveCredentials(wsId, p, { secret: { refreshToken: "demo" }, accountLabel: "saqlain@leadlift.app" });
  await saveCredentials(wsId, "GOOGLE_DRIVE", { secret: { refreshToken: "demo" }, accountLabel: "saqlain@leadlift.app", config: { lastBackupAt: new Date(now.getTime() - 5 * 3600_000).toISOString(), lastBackupName: "leadlift-2026-11-02-04-00.db.gz", lastBackupBytes: 1_830_000 } });
  await db.workspaceSettings.update({ where: { workspaceId: wsId }, data: { companyEmail: "saqlain@leadlift.app", companyPhone: "+92 300 1234567", companyWebsite: "https://leadlift.app", brandColor: "#4f46e5" } });

  // ── My Websites ──
  const lahore = await createWebsite(wsId, userId, { name: "Lahore Spice Kitchen", url: "https://lahorespicekitchen.pk", kind: "CLIENT" });
  const smileSite = await createWebsite(wsId, userId, { name: "Bright Smile Dental", url: "https://brightsmiledental.co.uk", kind: "CLIENT" });
  const movers = await createWebsite(wsId, userId, { name: "Karachi Movers", url: "https://karachimovers.pk", kind: "CLIENT" });
  for (const w of [lahore, smileSite, movers]) await db.website.update({ where: { id: w.id }, data: { gscSiteUrl: `sc-domain:${w.domain}`, siteStatus: "UP", siteCheckedAt: new Date(now.getTime() - 6 * 60_000), robotsCheckedAt: new Date(now.getTime() - 3 * 3600_000), robotsBody: "User-agent: *\nAllow: /\nSitemap: https://" + w.domain + "/sitemap.xml", sitemapUrlCount: 24, changesCheckedAt: new Date(now.getTime() - 2 * DAY) } });

  // Pages seen by the weekly check (the indexing check and the plan use them).
  const paths = ["/", "/menu", "/delivery", "/catering", "/about", "/contact", "/deals", "/reviews", "/blog/best-biryani-in-lahore", "/blog/karahi-guide", "/gallery", "/reservations"];
  await db.pageSnapshot.createMany({ data: paths.map((p) => ({ websiteId: lahore.id, url: `https://lahorespicekitchen.pk${p}`, status: 200, title: p === "/" ? "Lahore Spice Kitchen — Desi Restaurant in Gulberg" : `${p.split("/").pop()!.replace(/-/g, " ")} | Lahore Spice Kitchen` })) });

  // Keyword tracking: 20 days of positions.
  await addKeywords(wsId, lahore.id, "restaurant in lahore\nbest biryani lahore\nfamily restaurant gulberg\nhome delivery food lahore\nkarahi lahore\ndesi food lahore");
  await syncPositions(wsId, lahore.id, fakeFetch, new Date(now.getTime() - 10 * DAY));
  await syncPositions(wsId, lahore.id, fakeFetch, now);

  // Alerts: one open, one resolved.
  await raiseAlert(wsId, lahore.id, { kind: "PAGE_GONE", dedupeKey: "gone:/old-menu", title: "A page returns 404", detail: "https://lahorespicekitchen.pk/old-menu", url: "https://lahorespicekitchen.pk/old-menu" });
  await raiseAlert(wsId, lahore.id, { kind: "SITE_DOWN", dedupeKey: "down:demo", title: "lahorespicekitchen.pk is down", detail: "The home page answered with HTTP 503." });
  await db.siteAlert.updateMany({ where: { websiteId: lahore.id, kind: "SITE_DOWN" }, data: { resolvedAt: new Date(now.getTime() - 3 * DAY), createdAt: new Date(now.getTime() - 3 * DAY - 2 * 3600_000) } });

  // Work log for last month and this month, spread over the days (marks on the chart).
  const last = shiftMonth(monthKey(), -1);
  const work: [string, string, string, number, number][] = [
    [last, "NEW_CONTENT", "Published “Best biryani in Lahore: a local guide”", 1, 26],
    [last, "INTERNAL_LINKING", "Linked menu items to the delivery page", 14, 22],
    [last, "LOCAL", "Updated Google Business Profile photos and hours", 1, 18],
    [last, "ONPAGE", "Rewrote titles and descriptions of 6 pages", 6, 12],
    [last, "SCHEMA", "Added Restaurant and Menu schema", 1, 9],
    [monthKey(), "CONTENT_OPTIMIZATION", "Expanded the catering page", 1, 1],
  ];
  for (const [month, category, title, count, daysAgo] of work) {
    await addWork(wsId, lahore.id, { month, category, title, count });
    const row = await db.workLogEntry.findFirst({ where: { websiteId: lahore.id, title }, orderBy: { createdAt: "desc" } });
    await db.workLogEntry.update({ where: { id: row!.id }, data: { createdAt: new Date(now.getTime() - daysAgo * DAY) } });
  }
  const changes: [string, string, string | null, string | null, number][] = [
    ["/blog/best-biryani-in-lahore", "NEW_PAGE", null, "Best biryani in Lahore: a local guide", 25],
    ["/catering", "TITLE", "Catering", "Catering for weddings and events in Lahore", 12],
    ["/menu", "CONTENT", null, null, 11],
    ["/delivery", "META_DESCRIPTION", null, "Hot desi food delivered across Lahore in 40 minutes.", 10],
  ];
  for (const [p, kind, before, after, daysAgo] of changes) await db.siteChange.create({ data: { workspaceId: wsId, websiteId: lahore.id, url: `https://lahorespicekitchen.pk${p}`, kind, before, after, detectedAt: new Date(now.getTime() - daysAgo * DAY) } });

  // Google indexing (URL Inspection, fictional answers).
  await runIndexCheck(wsId, lahore.id, fakeFetch);

  // Competitor watch.
  for (const [name, domain, items] of [
    ["Gulberg Grill House", "gulberggrill.pk", [["NEW_PAGE", "/ramadan-deals", "Ramadan deals 2026"], ["NEW_PAGE", "/catering", "Event catering in Lahore"], ["TITLE", "/", "Gulberg Grill House — BBQ and Karahi in Lahore"]]],
    ["Royal Biryani Co", "royalbiryani.pk", [["NEW_PAGE", "/blog/biryani-vs-pulao", "Biryani vs pulao: what is the difference?"], ["CONTENT", "/menu", null]]],
  ] as const) {
    const c = await db.watchedCompetitor.create({ data: { workspaceId: wsId, websiteId: lahore.id, name, url: `https://${domain}/`, domain, changesCheckedAt: new Date(now.getTime() - DAY) } });
    for (const [i, [kind, p, after]] of items.entries()) await db.siteChange.create({ data: { workspaceId: wsId, competitorId: c.id, url: `https://${domain}${p}`, kind, after, detectedAt: new Date(now.getTime() - (i + 2) * DAY) } });
  }

  // 12-month content calendar from the (fictional) Search Console data.
  const plan = await createContentPlan(wsId, lahore.id, fakeFetch, now, null);
  await setPlanItemStatus(wsId, plan.items[0].id, "DONE");

  // Monthly report email: prepared on the 2nd, waiting for approval.
  await saveReportSchedule(wsId, lahore.id, { day: 2, email: "owner@lahorespicekitchen.pk", approval: true });
  await db.reportDelivery.create({ data: { workspaceId: wsId, websiteId: lahore.id, month: last, to: "owner@lahorespicekitchen.pk", status: "AWAITING_APPROVAL" } });

  // ── Prospects: technology, email health, reply, lead scores ──
  const dns: Resolver = {
    mx: async (d) => (d.endsWith(".co.uk") ? [{ exchange: "aspmx.l.google.com", priority: 1 }] : [{ exchange: "mx1.titan.email", priority: 10 }]),
    txt: async (d) => (d === "brightsmiledental.co.uk" ? [["v=spf1 include:_spf.google.com ~all"]] : d.startsWith("_dmarc.brightsmiledental") ? [["v=DMARC1; p=none"]] : d === "desertskyballoons.ae" ? [["v=spf1 +all"]] : []),
  };
  const stacks: Record<string, string> = {
    [o.sky]: `<meta name="generator" content="WordPress 6.2.1"><link href="/wp-content/plugins/elementor/a.css"><link href="/wp-content/plugins/contact-form-7/b.css"><div class="elementor-page"></div><script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="/wp-includes/js/jquery/jquery.min.js"></script>`,
    [o.smile]: `<img src="https://static.wixstatic.com/media/a.jpg"><script src="https://www.googletagmanager.com/gtag/js?id=G-DEMO1"></script><a href="https://calendly.com/brightsmile">Book</a>`,
    [o.movers]: `<meta name="generator" content="WordPress 6.4"><link href="/wp-content/plugins/wordpress-seo/x.css"><!-- This site is optimized with the Yoast SEO plugin --><a href="https://wa.me/923001234567">WhatsApp</a>`,
  };
  for (const [id, html] of Object.entries(stacks)) {
    const p = await db.prospect.findUniqueOrThrow({ where: { id } });
    await db.prospect.update({ where: { id }, data: { techStack: detectStack(html, { server: "LiteSpeed", "x-powered-by": id === o.sky ? "PHP/7.4.33" : "PHP/8.2.1" }), emailHealth: await checkEmailHealth(p.domain, dns), techCheckedAt: new Date(now.getTime() - 3600_000) } });
  }
  await handleReply(wsId, o.smile, { messageId: "demo-reply-1", fromEmail: "hello@brightsmiledental.co.uk", subject: "Re: Your SEO proposal — Bright Smile Dental", snippet: "Thanks Saqlain, this is really clear. Can we have a quick call on Thursday about the implants page?", receivedAt: new Date(now.getTime() - 40 * 60_000) });

  // ── Karachi Movers accepted and signed online → service agreement ──
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const signature = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 110;
    const x = c.getContext("2d")!;
    x.strokeStyle = "#0b1f3a";
    x.lineWidth = 3;
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(20, 70);
    x.bezierCurveTo(40, 10, 70, 100, 95, 50);
    x.bezierCurveTo(110, 25, 130, 90, 150, 60);
    x.bezierCurveTo(170, 30, 190, 80, 215, 55);
    x.bezierCurveTo(240, 35, 265, 85, 300, 45);
    x.moveTo(60, 88);
    x.lineTo(320, 82);
    x.stroke();
    return c.toDataURL("image/png");
  });
  await browser.close();
  await db.proposal.update({ where: { id: o.moversProposal }, data: { status: "ACCEPTED", acceptedAt: new Date(now.getTime() - 2 * DAY) } });
  await db.proposalResponse.create({ data: { proposalId: o.moversProposal, kind: "ACCEPT", name: "Imran Ali", contact: "+92 300 1234567", signature, version: 1 } });
  await db.proposalVersion.updateMany({ where: { proposalId: o.moversProposal }, data: { monthlyPrice: 45000, setupFee: 20000 } });

  // ── Bulk audit list and an auto-send campaign ──
  const batch = await db.auditBatch.create({ data: { workspaceId: wsId, name: "Dubai, Leeds & Karachi leads — November", createdById: userId } });
  await db.websiteAudit.updateMany({ where: { workspaceId: wsId, prospectId: { in: [o.sky, o.smile, o.movers] } }, data: { batchId: batch.id } });
  const skyProposal = await db.proposal.findFirstOrThrow({ where: { prospectId: o.sky } });
  await db.campaign.create({
    data: {
      workspaceId: wsId,
      batchId: batch.id,
      name: "Auto-send: Dubai, Leeds & Karachi leads",
      dailyLimit: 15,
      createdById: userId,
      lastSentAt: new Date(now.getTime() - 2 * DAY),
      recipients: {
        create: [
          { proposalId: o.smileProposal, email: "hello@brightsmiledental.co.uk", status: "SENT", sentAt: new Date(now.getTime() - 2 * DAY), sortOrder: 0 },
          { proposalId: skyProposal.id, email: "bookings@desertskyballoons.ae", status: "QUEUED", sortOrder: 1 },
        ],
      },
    },
  });

  await refreshLeadScores(wsId);

  // ── A finished audit video with voice-over for Desert Sky ──
  const audit = await db.websiteAudit.findFirstOrThrow({ where: { prospectId: o.sky, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" } });
  const video = await db.auditVideo.create({ data: { workspaceId: wsId, prospectId: o.sky, auditId: audit.id } });
  await generateAuditVideo(video.id, "female").catch((e) => console.log("video not made:", (e as Error).message));

  // Unread notifications for the bell.
  await db.notification.updateMany({ where: { workspaceId: wsId }, data: { readAt: new Date() } });
  for (const [title, link] of [
    ["Bright Smile Dental replied", `/prospects/${o.smile}`],
    [`Lahore Spice Kitchen: ${new Date(`${last}-15`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} report is ready to send`, `/websites/${lahore.id}#report-email`],
    ["Audit video ready: Desert Sky Balloon Rides", `/prospects/${o.sky}#video`],
  ]) await db.notification.create({ data: { workspaceId: wsId, title, link } });
  return { lahoreId: lahore.id };
}
