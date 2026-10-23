/**
 * Seeds a clearly labelled DEMO workspace with fictional prospects on reserved `.example` domains.
 * It never touches other workspaces. Run with `npm run db:seed`.
 */
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_PIPELINE_STATUSES } from "../src/lib/constants";

try {
  process.loadEnvFile(".env");
} catch {}

const raw = process.env.DATABASE_URL ?? "file:./dev.db";
const url = raw.startsWith("file:./") ? `file:${path.resolve(raw.slice(5))}` : raw;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const DEMO_EMAIL = "demo@seo-os.example";
const DEMO_PASSWORD = "DemoWorkspace2026";

const days = (n: number) => new Date(Date.now() + n * 86400_000);

const PROSPECTS = [
  { businessName: "Bright Smile Dental (demo)", domain: "brightsmile-dental.example", industry: "Dental clinic", country: "United Kingdom", city: "Leeds", services: "Dental implants, Invisalign, Teeth whitening", source: "Website audit outreach", status: "PROPOSAL_SENT", value: 1200, currency: "GBP", createdDaysAgo: 30 },
  { businessName: "Northside Plumbing Co (demo)", domain: "northside-plumbing.example", industry: "Home services", country: "United States", city: "Chicago", services: "Emergency plumbing, Water heaters", source: "Referral", status: "MEETING_SCHEDULED", value: 900, currency: "USD", createdDaysAgo: 22 },
  { businessName: "Lahore Leather Works (demo)", domain: "lahore-leather.example", industry: "E-commerce", country: "Pakistan", city: "Lahore", services: "Leather jackets, Bags", source: "LinkedIn", status: "NEW_PROSPECT", value: null, currency: "USD", createdDaysAgo: 5 },
  { businessName: "Desert Safari Tours (demo)", domain: "desert-safari-tours.example", industry: "Travel", country: "United Arab Emirates", city: "Dubai", services: "Desert safari, City tours", source: "Website audit outreach", status: "WON", value: 1500, currency: "USD", createdDaysAgo: 60 },
  { businessName: "Greenleaf Accountants (demo)", domain: "greenleaf-accountants.example", industry: "Professional services", country: "Canada", city: "Toronto", services: "Bookkeeping, Tax returns", source: "Inbound enquiry", status: "LOST", value: 800, currency: "USD", createdDaysAgo: 45 },
] as const;

async function main() {
  const existing = await db.workspace.findFirst({ where: { isDemo: true } });
  if (existing) {
    console.log("Demo workspace already exists — nothing to do.");
    return;
  }

  const user =
    (await db.user.findUnique({ where: { email: DEMO_EMAIL } })) ??
    (await db.user.create({
      data: { email: DEMO_EMAIL, name: "Demo Consultant", passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12) },
    }));

  const ws = await db.workspace.create({
    data: {
      name: "Demo Workspace (sample data)",
      isDemo: true,
      memberships: { create: { userId: user.id, role: "OWNER" } },
      settings: { create: { consultantName: "Demo Consultant", companyName: "Demo SEO Studio" } },
      pipelineStatuses: {
        create: DEFAULT_PIPELINE_STATUSES.map((s, i) => ({ key: s.key, label: s.label, sortOrder: i, isTerminal: s.isTerminal ?? false, isSystem: true })),
      },
    },
  });

  for (const p of PROSPECTS) {
    const createdAt = days(-p.createdDaysAgo);
    const prospect = await db.prospect.create({
      data: {
        workspaceId: ws.id,
        ownerId: user.id,
        businessName: p.businessName,
        websiteUrl: `https://${p.domain}`,
        domain: p.domain,
        industry: p.industry,
        country: p.country,
        city: p.city,
        primaryServices: p.services,
        leadSource: p.source,
        status: p.status,
        estimatedValue: p.value,
        currency: p.currency,
        wonValue: p.status === "WON" ? p.value : null,
        lostReason: p.status === "LOST" ? "Chose to keep work in-house this year (demo)" : null,
        createdAt,
        lastActivityAt: createdAt,
        contacts: {
          create: [
            { type: "EMAIL", value: `info@${p.domain}`, sourceMethod: "MANUAL", validationStatus: "VALID_FORMAT", verified: true, isPreferred: true },
          ],
        },
        activities: {
          create: { workspaceId: ws.id, userId: user.id, type: "prospect.created", message: `Prospect ${p.businessName} created`, createdAt },
        },
      },
    });

    if (p.status === "WON" || p.status === "LOST") {
      await db.deal.create({
        data: {
          workspaceId: ws.id,
          prospectId: prospect.id,
          title: `${p.businessName} — SEO`,
          stage: p.status,
          value: p.value,
          currency: p.currency,
          closedAt: days(-3),
          lostReason: p.status === "LOST" ? "Chose to keep work in-house this year (demo)" : null,
        },
      });
    }
    if (p.status === "PROPOSAL_SENT" || p.status === "MEETING_SCHEDULED") {
      const dueAt = p.status === "PROPOSAL_SENT" ? days(-1) : days(2);
      await db.followUp.create({
        data: {
          workspaceId: ws.id,
          prospectId: prospect.id,
          type: p.status === "PROPOSAL_SENT" ? "PROPOSAL_REMINDER" : "MEETING_REMINDER",
          dueAt,
          note: "Demo follow-up",
        },
      });
      await db.prospect.update({ where: { id: prospect.id }, data: { nextFollowUpAt: dueAt } });
    }
  }

  console.log("Demo workspace created.");
  console.log(`  Sign in with: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("  All demo data uses fictional .example domains and is labelled as demo in the UI.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
