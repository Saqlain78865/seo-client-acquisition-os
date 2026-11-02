// Builds tour.db for the full product tour (run with DATABASE_URL=file:./tour.db, STORAGE_DIR=tour-storage): real audits of fictional local sites, proposals in every
// state, a reputation case, pipeline, deals and client work. Run with DATABASE_URL=file:./demo.db.
import { db } from "../../src/lib/db.ts";
import bcrypt from "bcryptjs";
const hashPassword = (p: string) => bcrypt.hash(p, 12);
import { createWorkspace } from "../../src/lib/workspace.ts";
import { createProspect } from "../../src/lib/prospects.ts";
import { runnerOptions } from "../../src/lib/audit/runner.ts";
import { startAudit } from "../../src/lib/audit/service.ts";
import { saveManualGbp } from "../../src/lib/research/service.ts";
import { markSent } from "../../src/lib/messaging/service.ts";
import { createShareLink } from "../../src/lib/messaging/share.ts";
import { markSeenOnWhatsApp, markSentOnWhatsApp } from "../../src/lib/messaging/manual.ts";
import { markWon } from "../../src/lib/kickoff.ts";
import { planMonth, monthKey } from "../../src/lib/client-work.ts";
import { SITES, startSites } from "../_demo/sites.mts";
import { extend } from "./extend.mts";

const DAY = 86400_000;
runnerOptions.allowPrivateNetworks = true;
const servers = startSites();

const user = await db.user.create({ data: { email: "demo@leadlift.app", name: "Saqlain Nazir", passwordHash: await hashPassword("LeadLiftDemo2026!") } });
const ws = await createWorkspace("LeadLift Agency", user.id);
await db.workspaceSettings.update({ where: { workspaceId: ws.id }, data: { consultantName: "Saqlain Nazir", companyName: "LeadLift Agency" } });

// ── Real audits of the three demo sites ──
const meta = [
  { city: "Dubai", country: "United Arab Emirates", service: "Hot air balloon rides", currency: "AED" },
  { city: "Leeds", country: "United Kingdom", service: "Family dentistry", currency: "GBP" },
  { city: "Karachi", country: "Pakistan", service: "House shifting", currency: "PKR" },
] as const;
const audits = [];
for (const [i, s] of SITES.entries()) {
  const m = meta[i];
  // Every demo site is on 127.0.0.1, so each audit is tied to its own prospect explicitly.
  const pr = await createProspect(ws.id, user.id, { businessName: s.name, websiteUrl: `http://127.0.0.1:${s.port}/`, city: m.city, country: m.country, currency: m.currency, primaryServices: m.service, leadSource: "Website audit outreach" } as Parameters<typeof createProspect>[2]);
  const r = await startAudit(ws.id, user.id, { prospectId: pr.id, websiteUrl: `http://127.0.0.1:${s.port}/`, clientName: s.name, targetCity: m.city, targetCountry: m.country, primaryService: m.service, currency: m.currency as "USD", autoProposal: true });
  audits.push(r);
  console.log("audit started", s.name);
}
for (const a of audits) {
  for (let t = 0; t < 600; t++) {
    const row = await db.websiteAudit.findUnique({ where: { id: a.audit.id } });
    if (row && ["COMPLETED", "PARTIAL", "FAILED"].includes(row.status) && (await db.proposal.findFirst({ where: { auditId: a.audit.id } }))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("audit done", (await db.websiteAudit.findUnique({ where: { id: a.audit.id } }))?.status);
}
for (const s of servers) s.close();

// ── Show real-looking addresses instead of 127.0.0.1 ──
const tables = (await db.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'`)).map((t) => t.name);
for (const t of tables) {
  const cols = await db.$queryRawUnsafe<{ name: string; type: string }[]>(`PRAGMA table_info("${t}")`);
  for (const c of cols.filter((c) => /TEXT|JSON/i.test(c.type))) {
    for (const s of SITES) {
      await db.$executeRawUnsafe(`UPDATE "${t}" SET "${c.name}" = REPLACE(REPLACE("${c.name}", 'http://127.0.0.1:${s.port}', 'https://${s.domain}'), '127.0.0.1:${s.port}', '${s.domain}') WHERE "${c.name}" LIKE '%127.0.0.1:${s.port}%'`);
    }
  }
}
await db.$executeRawUnsafe(`UPDATE "Prospect" SET "domain" = REPLACE("domain", '127.0.0.1', '') WHERE "domain" = '127.0.0.1'`);
for (const [i, s] of SITES.entries()) await db.prospect.update({ where: { id: audits[i].prospect.id }, data: { domain: s.domain, websiteUrl: `https://${s.domain}`, city: meta[i].city, country: meta[i].country, businessName: s.name } });

const [sky, smile, movers] = audits.map((a) => a.prospect.id);
const proposalOf = async (prospectId: string) => (await db.proposal.findFirst({ where: { prospectId }, orderBy: { createdAt: "asc" } }))!;

// ── Contacts ──
for (const c of [
    { prospectId: sky, type: "PERSON_NAME", value: "Omar Haddad", sourceMethod: "MANUAL" },
    { prospectId: sky, type: "EMAIL", value: "bookings@desertskyballoons.ae", sourceMethod: "MANUAL", verified: true },
    { prospectId: smile, type: "PERSON_NAME", value: "Dr. Sarah Lee", sourceMethod: "MANUAL" },
    { prospectId: smile, type: "EMAIL", value: "hello@brightsmiledental.co.uk", sourceMethod: "MANUAL", verified: true },
    { prospectId: movers, type: "PERSON_NAME", value: "Imran Ali", sourceMethod: "MANUAL" },
    { prospectId: movers, type: "WHATSAPP", value: "+923001234567", sourceMethod: "MANUAL" },
]) await db.prospectContact.create({ data: c }).catch(() => undefined);

// ── Bright Smile: emailed, opened and being read ──
const smileP = await proposalOf(smile);
await db.proposalVersion.updateMany({ where: { proposalId: smileP.id }, data: { monthlyPrice: 650, setupFee: 400 } });
await db.emailDelivery.create({ data: { proposalId: smileP.id, versionNumber: 1, idempotencyKey: `demo-${smileP.id}`, channelMethod: "GMAIL_API", sender: "saqlain@leadlift.app", recipient: "hello@brightsmiledental.co.uk", subject: "Your SEO proposal — Bright Smile Dental", status: "ACCEPTED", sentAt: new Date(Date.now() - 2 * DAY) } });
await markSent(ws.id, user.id, smileP.id, 1, "email", true);
await createShareLink(ws.id, user.id, smileP.id, 30);
await db.proposal.update({ where: { id: smileP.id }, data: { shareViews: 3, shareLastViewedAt: new Date(Date.now() - 25 * 60_000) } });
await db.proposalReadSession.create({ data: { proposalId: smileP.id, version: 1, visitorKey: "demo", device: "MOBILE", totalMs: 312_000, sections: { deliverables: 140_000, key_findings: 90_000, executive_summary: 50_000, roadmap: 32_000 }, startedAt: new Date(Date.now() - 31 * 60_000), lastSeenAt: new Date(Date.now() - 25 * 60_000) } });

// ── Karachi Movers: sent on WhatsApp, seen ──
const moversP = await proposalOf(movers);
await markSentOnWhatsApp(ws.id, user.id, moversP.id);
await markSeenOnWhatsApp(ws.id, user.id, moversP.id);
await db.followUp.updateMany({ where: { proposalId: moversP.id, type: "OPENED_NO_REPLY" }, data: { dueAt: new Date(Date.now() - DAY) } });

// ── Desert Sky: its Google Business Profile with a few bad reviews ──
await saveManualGbp(ws.id, user.id, sky, {
  name: "Desert Sky Balloon Rides",
  rating: 3.7,
  reviewCount: 46,
  photoCount: 6,
  hasHours: false,
  hasWebsite: true,
  hasPhone: true,
  rankQuery: "hot air balloon dubai",
  rankPosition: 14,
  badReviewsText: [
    "1★ Total scam!! Don't book here, go with SkyHigh Balloons instead, they are much better and cheaper.",
    "2★ Pickup was 50 minutes late and nobody answered the phone. The flight itself was nice but the organisation was poor.",
    "1★ Terrible terrible terrible. Never again.",
  ].join("\n\n"),
});

// ── More pipeline: a won client with monthly work, a meeting, new leads ──
const extra = [
  { businessName: "Lahore Spice Kitchen", websiteUrl: "lahorespicekitchen.pk", city: "Lahore", country: "Pakistan", status: "WON", value: 900 },
  { businessName: "Gulf Auto Repair", websiteUrl: "gulfautorepair.ae", city: "Sharjah", country: "United Arab Emirates", status: "MEETING_SCHEDULED", value: 1200 },
  { businessName: "Marina Yacht Charters", websiteUrl: "marinayachts.ae", city: "Dubai", country: "United Arab Emirates", status: "NEW_PROSPECT", value: 1500 },
  { businessName: "Oxford Home Tutors", websiteUrl: "oxfordhometutors.co.uk", city: "Oxford", country: "United Kingdom", status: "NEGOTIATION", value: 700 },
];
for (const e of extra) {
  const p = await createProspect(ws.id, user.id, { businessName: e.businessName, websiteUrl: e.websiteUrl, city: e.city, country: e.country, currency: "USD", leadSource: "Website audit outreach", estimatedValue: e.value } as Parameters<typeof createProspect>[2]);
  if (e.status === "WON") {
    await db.prospect.update({ where: { id: p.id }, data: { wonValue: e.value } });
    await markWon(ws.id, p.id, { reason: "Signed the proposal", userId: user.id });
    await db.prospect.update({ where: { id: p.id }, data: { status: "WON" } });
    await planMonth(ws.id, user.id, p.id, monthKey());
    const tasks = await db.clientTask.findMany({ where: { prospectId: p.id }, take: 3 });
    for (const [i, t] of tasks.entries()) await db.clientTask.update({ where: { id: t.id }, data: i < 2 ? { status: "DONE", doneAt: new Date() } : { status: "DOING" } });
  } else {
    await db.prospect.update({ where: { id: p.id }, data: { status: e.status } });
  }
}
await db.followUp.create({ data: { workspaceId: ws.id, prospectId: smile, proposalId: smileP.id, type: "CUSTOM", dueAt: new Date(), note: "Call Dr. Lee about the implants page" } });
await db.notification.updateMany({ where: { workspaceId: ws.id }, data: { readAt: new Date() } }).catch(() => undefined);
const extra2 = await extend({ wsId: ws.id, userId: user.id, sky, smile, movers, smileProposal: smileP.id, moversProposal: moversP.id });
console.log("tour data ready", JSON.stringify(extra2));
process.exit(0);
