// Captures the product tour from the running demo app (tour.db): a 1920×1080 screenshot per step,
// the box of the part of the screen each step talks about, and the narration. Writes
// <outDir>/manifest.json for render.mjs. Usage: node scripts/_tour/capture.mjs <baseUrl> <outDir>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const chapters = [];
let shotNo = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function go(p) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => page.waitForLoadState("load"));
  await wait(900);
}
/** Finds an element, brings it into view, and returns its box in the screenshot. */
async function box(target) {
  if (!target) return null;
  try {
    const l = typeof target === "string" ? page.getByText(target, { exact: false }).first() : target;
    await l.waitFor({ state: "visible", timeout: 8000 });
    await l.scrollIntoViewIfNeeded();
    await wait(350);
    const b = await l.boundingBox();
    return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
  } catch {
    console.warn("  (not found)", typeof target === "string" ? target : "locator");
    return null;
  }
}
/** Card around a heading: the nearest rounded container. */
const card = (title) => page.locator("div.rounded-2xl").filter({ has: page.locator("h2", { hasText: title }) }).last();

function chapter(title, subtitle, narration) {
  chapters.push({ title, subtitle, narration, steps: [] });
}
/** One step: optional element to focus (with callout text), then a screenshot. */
async function step(narration, opts = {}) {
  const focus = await box(opts.focus);
  if (opts.top) {
    await page.evaluate(() => scrollTo(0, 0));
    await wait(300);
  }
  const file = `shot-${String(++shotNo).padStart(3, "0")}.jpg`;
  await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 88 });
  const s = { image: file, narration, focus: opts.top ? null : focus, callout: opts.callout ?? null, click: !!opts.click, zoom: opts.zoom ?? 1.35 };
  chapters.at(-1).steps.push(s);
  console.log(`${chapters.length}.${chapters.at(-1).steps.length} ${file}${focus ? "" : " (no focus)"}`);
}

// ── Sign in ──
await go("/login");
chapter("Welcome to LeadLift", "Find, audit, pitch and grow SEO clients — in one desktop app", "Welcome to LeadLift. In the next few minutes you will see every part of the app, and exactly how to use it — from finding a new client to sending their monthly report.");
await step("Everything stays on your own computer. Sign in with your email and password, and you land on the Overview.", { focus: page.locator("form").first(), callout: { title: "Sign in", text: "Your data stays on this computer" } });
await page.getByLabel(/email/i).first().fill("demo@leadlift.app");
await page.getByLabel(/password/i).first().fill("LeadLiftDemo2026!");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }), page.getByRole("button", { name: /sign in|log in/i }).first().click()]);
await wait(1500);

// ── 1. Overview ──
await go("/");
chapter("Overview", "Your daily starting point", "Start every day on the Overview.");
await step("The Overview shows who to contact today, the follow-ups that are due, and how your pipeline is doing — so you always know your next move.", { top: true });
await step("Who to contact today lists the warmest leads first, with the reason next to each one. Click a name to open the prospect.", { focus: card("Who to contact today"), callout: { title: "Who to contact today", text: "Warmest leads first, with the reason" }, click: true });
await step("Below it, charts show new prospects, your conversion rate, and which lead sources bring the best clients.", { focus: card("Conversion"), callout: { title: "Pipeline at a glance", text: "Prospects, conversion and lead sources" } });

// ── 2. New Website Audit ──
await go("/audits/new");
chapter("New Website Audit", "A full SEO audit of any website in minutes", "Every client starts with an audit.");
await step("Paste the website address of any business. LeadLift reads the public pages only — no login to their site is ever needed.", { focus: page.getByLabel("Website URL"), callout: { title: "Website URL", text: "Any public website" }, click: true });
await step("Add the business name, main service, country and city if you know them. They make the findings and the proposal local and specific.", { focus: page.getByLabel("Primary service"), callout: { title: "Business details", text: "Service, country and city" } });
await step("Press Start audit. In a few minutes you get a full report: technical problems, content, local SEO, speed and screenshots — and, if you tick it, a ready proposal.", { focus: page.getByRole("button", { name: /start|audit/i }).last(), callout: { title: "Start audit", text: "Report and proposal in minutes" }, click: true });

// ── 3. Bulk Audit ──
await go("/audits/bulk");
chapter("Bulk Audit", "Audit a whole list and contact the best leads first", "Have a list of businesses? Use Bulk Audit.");
await step("Paste up to a hundred websites, one per line. Each one gets a quick audit, and the list is ranked by opportunity score.", { focus: page.locator("textarea").first(), callout: { title: "Paste a list", text: "One website per line" }, click: true });
await step("Your previous lists are kept here. Open one to see every site ranked, with its score and biggest problems, and create proposals for the best leads in one go.", { focus: card("Previous lists"), callout: { title: "Ranked by opportunity", text: "Best leads at the top" } });
const batchLink = page.locator("a[href^='/audits/bulk/']").first();
if (await batchLink.count()) {
  await batchLink.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(1200);
  await step("Each row shows the score and the issues found. From here you can also start Auto-send for the whole list.", { top: true });
}

// ── 4. Prospects ──
await go("/prospects?sort=hottest");
chapter("Prospects", "Your sales pipeline, scored and sorted", "Prospects is your pipeline.");
await step("Every business you audit or add becomes a prospect, with its status, contact details and value.", { top: true });
await step("The Score column is the lead score from zero to one hundred: how much they need help, and how warm they are. Sort by Hottest leads to see who to call first.", { focus: page.getByRole("columnheader", { name: "Score" }), callout: { title: "Lead score", text: "0–100, hover for the reasons" } });
await page.getByRole("link", { name: /Prospect Finder/ }).click();
await page.waitForLoadState("networkidle").catch(() => {});
await wait(800);
await page.getByLabel("Business type and city").fill("dentist Dubai");
await step("Prospect Finder finds new businesses for free. Type a business type and a city, such as dentist Dubai.", { focus: page.getByLabel("Business type and city"), callout: { title: "Prospect Finder", text: "Free, from OpenStreetMap" }, click: true });
await page.getByRole("button", { name: /Find businesses/ }).click();
await page.getByText(/businesses for/).first().waitFor({ timeout: 60_000 }).catch(() => {});
await wait(800);
await step("Businesses without a website come first — they are the easiest clients to win. Add any of them as a prospect with one click.", { focus: page.getByRole("button", { name: /Add as prospect/ }).first(), callout: { title: "Add as prospect", text: "Weakest profiles first" }, click: true });

const sky = await (await fetch(`${base}/api/health`).catch(() => null)) && null;
void sky;
await go("/prospects?sort=hottest");
await page.getByRole("link", { name: "Desert Sky Balloon Rides" }).first().click();
await page.waitForLoadState("networkidle").catch(() => {});
await wait(1200);
const prospectUrl = page.url();
await step("Open a prospect to see everything about them on one page: contacts, audits, proposals, notes and the full history.", { top: true });
await step("The lead score card explains every point — here, website issues, a low Google rating and missing reviews.", { focus: card("Lead score"), callout: { title: "Why this score", text: "Every point has a reason" } });
await step("Website technology and email health shows what their site is built with and whether their email domain is set up. The pitch notes turn this into talking points.", { focus: card("Website technology & email health"), callout: { title: "Pitch notes", text: "WordPress, Elementor, SPF and DMARC" } });
await step("Make a one-minute audit video with a voice-over that walks through every problem. Download it and send it on WhatsApp or by email.", { focus: card("Audit video"), callout: { title: "Audit video", text: "MP4 with voice-over" }, click: true });
await step("Schedule follow-ups, change the pipeline status, and keep notes from calls and meetings — all from the side of the page.", { focus: card("Pipeline status"), callout: { title: "Pipeline and follow-ups", text: "Everything about this lead" } });
await go(`${new URL(prospectUrl).pathname}/research?tab=gbp`);
await step("On the Research page you can add keywords, competitors and the Google Business Profile — rating, reviews and the competitors on Google Maps — so the proposal compares them.", { focus: card("Google Maps competitors"), callout: { title: "Research", text: "Profile and Maps competitors" } });

// ── 5. Audit Reports ──
await go("/audits");
chapter("Audit Reports", "Evidence-based findings, ready to show a client", "All audits are kept in Audit Reports.");
await step("Each audit keeps its crawled pages, evidence and findings, so you can come back to it any time.", { top: true });
await page.locator("a[href^='/audits/c']").first().click().catch(() => {});
await page.waitForLoadState("networkidle").catch(() => {});
await wait(1500);
await step("A report lists every problem by severity, with the pages it affects, the evidence and how to fix it — and screenshots of the website on a computer and a phone.", { top: true });
await page.mouse.wheel(0, 900);
await wait(900);
await step("Findings marked critical or high are the ones to talk about first. Each one explains the business impact in plain words, not jargon.");

// ── 6. SEO Proposals ──
await go("/proposals");
chapter("SEO Proposals", "Professional proposals, written from the audit", "Turn an audit into a proposal.");
await step("SEO Proposals shows which proposals are drafts, which went out, and on which channel — email or WhatsApp.", { top: true });
await page.getByRole("link", { name: /Bright Smile/ }).first().click();
await page.waitForLoadState("networkidle").catch(() => {});
await wait(1800);
await step("A proposal is written for you from the audit: the problems found, the plan, the timeline and your price. Edit any part, then download the PDF or send it.", { top: true });
await step("When you share a link, you see when the client opens it and which parts they read — here, three visits and five minutes on the deliverables.", { focus: card("How the client read it"), callout: { title: "Read tracking", text: "Visits and time per section" } });
await go("/proposals");
await page.getByRole("link", { name: /Karachi City Movers/ }).first().click();
await page.waitForLoadState("networkidle").catch(() => {});
await wait(1500);
await step("When a client accepts online, they sign on the link — and a service agreement with their signature is ready to download.", { focus: page.getByRole("link", { name: /Download service agreement/ }), callout: { title: "Signed agreement", text: "Made from the proposal" }, click: true });

// ── 7. Follow-ups ──
await go("/follow-ups");
chapter("Follow-ups", "Never forget to follow up again", "Follow-ups keep every deal moving.");
await step("Follow-ups lists every reminder by date: proposals to chase, meetings and calls. Mark one done when you have followed up.", { top: true });
await step("With Google Calendar connected, every follow-up also appears in your calendar with a reminder. And when a client replies by email, their follow-ups stop by themselves.", { focus: page.locator("main li, main tr").first(), callout: { title: "Calendar and replies", text: "Reminders in Google Calendar" } });

// ── 8. Auto-send ──
await go("/campaigns");
chapter("Auto-send", "Approve once — emailed for you, a few a day", "Auto-send emails approved proposals for you.");
await step("Choose proposals from a bulk list, approve them once, and LeadLift emails them from your Gmail — a few each day, in working hours, so they look personal.", { top: true });
await step("You can pause or stop a campaign at any time. Replies stop the emails to that client automatically.", { focus: page.getByText(/Auto-send: /).first(), callout: { title: "Campaign", text: "Pause or stop any time" } });

// ── 9. Clients and Deals ──
await go("/deals");
chapter("Clients and Deals", "Won and lost deals, and your revenue", "Clients and Deals records the result of every sale.");
await step("A deal is recorded when you mark a prospect won or lost, or when a client accepts online. Won clients get a kickoff checklist so nothing is forgotten.", { top: true });

// ── 10. Client Work ──
await go("/work");
chapter("Client Work", "Plan and deliver the monthly work", "Client Work is where you deliver.");
await step("For each won client, plan the month from the proposal, move tasks from to-do to done, and turn the finished work into the client report.", { top: true });

// ── 11. My Websites ──
await go("/websites");
chapter("My Websites", "Search Console, alerts, keywords and monthly reports", "My Websites is for the sites you look after.");
await step("Add your own websites and your clients' websites here, and link each one to its Google Search Console property — read-only.", { top: true });
await page.getByRole("link", { name: /Lahore Spice Kitchen/ }).first().click();
await page.waitForLoadState("networkidle").catch(() => {});
await page.locator("svg[aria-label='Search performance over time']").first().waitFor({ timeout: 60_000 }).catch(() => {});
await wait(2500);
await step("The explorer shows clicks, impressions and positions from Google, compared with the previous period. Search, filter and drill into any query or page.", { top: true });
await step("The orange marks on the chart show the work you did on each day, so the client sees what made the difference.", { focus: page.locator("svg[aria-label='Search performance over time']").first(), callout: { title: "Work on the chart", text: "What was done, and when" }, zoom: 1.2 });
await step("Alerts watch the website for you: if the site goes down, a page disappears, traffic falls or a keyword drops, you are told straight away.", { focus: card("Alerts"), callout: { title: "Alerts", text: "Down, page gone, traffic, keywords" } });
await step("Google indexing shows how many pages are in Google, and why the others are not. Robots and sitemap are checked every day.", { focus: card("Google indexing & site health"), callout: { title: "Indexing and site health", text: "Pages in Google, and why not" } });
await step("Keyword rank tracking follows up to fifty searches, with their daily position from Search Console.", { focus: card("Keyword rank tracking"), callout: { title: "Rank tracking", text: "Daily positions, alerts on drops" } });
await step("The content calendar plans twelve months of topics from the searches the site already appears for. Tick a topic when it is done and it goes into the monthly report.", { focus: card("12-month content calendar"), callout: { title: "Content calendar", text: "Twelve months of topics" } });
await step("Choose a day of the month and the client's email. On that day the monthly report is prepared as a PDF and waits for your approval before it is sent.", { focus: card("Monthly report email"), callout: { title: "Report email", text: "Your day, your approval" } });
await step("Competitor watch checks up to three competitor websites every week: new pages, new articles and title changes.", { focus: card("Competitor watch"), callout: { title: "Competitor watch", text: "What competitors changed" } });
await step("And the work log records what you did each month — it is the heart of the monthly report.", { focus: card("Work log"), callout: { title: "Work log", text: "Real work, for the report" } });

// ── 12. Message Templates ──
await go("/templates");
chapter("Message Templates", "Reusable emails with placeholders", "Message Templates saves you typing.");
await step("Write an email once with placeholders like client name and website, and reuse it for every prospect. A live preview shows exactly what will be sent.", { top: true });

// ── 13. Reports and Analytics ──
await go("/reports");
chapter("Reports and Analytics", "How your agency is really doing", "Reports and Analytics shows your agency's numbers.");
await step("Monthly activity, which lead sources bring clients, the most common problems you find, proposals by status, and why deals were lost — all from your own records.", { top: true });

// ── 14. Integrations ──
await go("/integrations");
chapter("Integrations", "Connect Gmail, Search Console, Calendar and Drive", "Integrations connects LeadLift to your accounts.");
await step("Connect Gmail to send proposals and reports from your own address. Check your email domain here, so your emails do not land in spam.", { top: true });
await step("Google sign-in connects Search Console read-only, reply detection, Calendar for follow-ups, and Drive for a daily backup of your data.", { focus: page.getByText("Google Drive backup", { exact: true }), callout: { title: "Google connections", text: "Each with its own permission" } });

// ── 15. Settings ──
await go("/settings");
chapter("Settings", "Your brand on every proposal and report", "Settings is your brand.");
await step("Your company name, contact details, logo and brand colour appear on every proposal, report and video. You can also rename the pipeline stages.", { top: true });

// ── 16. Account & Team ──
await go("/account");
chapter("Account & Team", "Your login and your team", "Account and Team manages people.");
await step("Invite team members with limited access, change your password, and see where you are signed in.", { top: true });

// ── 17. System ──
await go("/system");
chapter("System", "Health, background jobs and your data", "System keeps everything healthy.");
await step("System shows the health of the installation, the background jobs, data retention, and lets you export all your workspace data at any time.", { top: true });

chapters.push({ title: "You're ready", subtitle: "Audit → Proposal → Follow-up → Client → Report", narration: "That is LeadLift. Start with Integrations, run your first audit, and send your first proposal today. Good luck, and win more clients.", steps: [], outro: true });

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ width: 1920, height: 1080, chapters }, null, 2));
await browser.close();
console.log("captured", shotNo, "shots in", chapters.length, "chapters");
