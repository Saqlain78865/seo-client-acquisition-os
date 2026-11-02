import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { hasRole, type SessionContext } from "@/lib/auth";
import {
  createProspect,
  exportProspectsCsv,
  findDuplicateProspects,
  getProspect,
  listProspects,
  mergeProspects,
  updateProspect,
} from "@/lib/prospects";
import { getDashboardData } from "@/lib/dashboard";

let wsA: string;
let wsB: string;
let userId: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `t${Date.now()}@test.example`, name: "Tester", passwordHash: "x" } });
  userId = user.id;
  wsA = (await createWorkspace("Workspace A", user.id)).id;
  wsB = (await createWorkspace("Workspace B", user.id)).id;
});

const base = { currency: "USD" };

describe("workspace bootstrap", () => {
  it("creates default pipeline statuses, settings and templates", async () => {
    const [statuses, settings, templates] = await Promise.all([
      db.pipelineStatus.count({ where: { workspaceId: wsA } }),
      db.workspaceSettings.findUnique({ where: { workspaceId: wsA } }),
      db.messageTemplate.count({ where: { workspaceId: wsA } }),
    ]);
    // Includes "Replied", set by Gmail reply detection.
    expect(statuses).toBe(13);
    expect(settings).not.toBeNull();
    // Email only: WhatsApp sending was removed.
    expect(templates).toBeGreaterThanOrEqual(1);
  });
});

describe("prospect CRUD and search", () => {
  it("normalises URL and stores manual contacts as verified", async () => {
    const p = await createProspect(wsA, userId, {
      ...base,
      businessName: "Acme Roofing",
      websiteUrl: "WWW.acme-roofing.example/",
      email: "Info@Acme-Roofing.example",
      phone: "+1 (312) 555-0100",
    });
    expect(p.domain).toBe("acme-roofing.example");
    const full = await getProspect(wsA, p.id);
    const email = full!.contacts.find((c) => c.type === "EMAIL")!;
    expect(email.value).toBe("info@acme-roofing.example");
    expect(email.verified).toBe(true);
    expect(full!.contacts.find((c) => c.type === "PHONE")!.value).toBe("+13125550100");
  });

  it("searches by name, domain, email and phone digits", async () => {
    for (const q of ["acme", "acme-roofing.example", "info@acme", "312555"]) {
      const r = await listProspects(wsA, { q });
      expect(r.rows.map((x) => x.businessName), q).toContain("Acme Roofing");
    }
  });

  it("isolates workspaces", async () => {
    expect((await listProspects(wsB, { q: "acme" })).total).toBe(0);
    const p = (await listProspects(wsA, { q: "acme" })).rows[0];
    expect(await getProspect(wsB, p.id)).toBeNull();
    expect(await updateProspect(wsB, p.id, { ...base, businessName: "Hijacked", websiteUrl: "x.example" })).toBe(false);
    expect((await getProspect(wsA, p.id))!.businessName).toBe("Acme Roofing");
  });

  it("detects duplicates by domain and by contact", async () => {
    expect(await findDuplicateProspects(wsA, { websiteUrl: "https://acme-roofing.example/contact" })).toHaveLength(1);
    expect(await findDuplicateProspects(wsA, { websiteUrl: "other.example", phone: "+1 312 555 0100" })).toHaveLength(1);
    expect(await findDuplicateProspects(wsB, { websiteUrl: "acme-roofing.example" })).toHaveLength(0);
  });

  it("paginates and filters", async () => {
    for (let i = 0; i < 6; i++) {
      await createProspect(wsB, userId, { ...base, businessName: `Biz ${i}`, websiteUrl: `biz${i}.example`, country: i % 2 ? "Pakistan" : "UAE" });
    }
    const page1 = await listProspects(wsB, { pageSize: 5, page: 1, sort: "name" });
    expect(page1.total).toBe(6);
    expect(page1.rows).toHaveLength(5);
    expect(page1.pageCount).toBe(2);
    expect((await listProspects(wsB, { country: "Pakistan" })).total).toBe(3);
  });
});

describe("merging duplicates", () => {
  it("moves related records, keeps unique contacts and deletes the source", async () => {
    const target = await createProspect(wsA, userId, { ...base, businessName: "Merge Target", websiteUrl: "merge.example", email: "a@merge.example" });
    const source = await createProspect(wsA, userId, {
      ...base,
      businessName: "Merge Source",
      websiteUrl: "www.merge.example",
      email: "a@merge.example",
      phone: "+44 20 7946 0958",
      country: "UK",
    });
    await db.followUp.create({ data: { workspaceId: wsA, prospectId: source.id, type: "CUSTOM", dueAt: new Date() } });

    await mergeProspects(wsA, target.id, source.id);
    const merged = await getProspect(wsA, target.id);
    expect(merged!.followUps).toHaveLength(1);
    expect(merged!.country).toBe("UK");
    expect(merged!.contacts.filter((c) => c.type === "EMAIL")).toHaveLength(1);
    expect(merged!.contacts.some((c) => c.type === "PHONE")).toBe(true);
    expect(await db.prospect.findUnique({ where: { id: source.id } })).toBeNull();
  });

  it("refuses cross-workspace merges", async () => {
    const a = await createProspect(wsA, userId, { ...base, businessName: "A1", websiteUrl: "a1.example" });
    const b = await createProspect(wsB, userId, { ...base, businessName: "B1", websiteUrl: "b1.example" });
    await expect(mergeProspects(wsA, a.id, b.id)).rejects.toThrow("not found");
  });
});

describe("CSV export", () => {
  it("escapes quotes and neutralises formula injection", async () => {
    await createProspect(wsA, userId, { ...base, businessName: '=HYPERLINK("http://evil")', websiteUrl: "csv.example" });
    const csv = await exportProspectsCsv(wsA, { q: "csv.example" });
    const [header, row] = csv.split("\r\n");
    expect(header.startsWith("Business name,Website")).toBe(true);
    expect(row.startsWith(`"'=HYPERLINK(""http://evil"")"`)).toBe(true);
  });
});

describe("permissions", () => {
  const ctx = (role: SessionContext["role"]) =>
    ({ role, sessionId: "s", user: { id: "u", email: "e", name: "n" }, workspace: { id: "w", name: "w", isDemo: false } }) as SessionContext;
  it("ranks roles", () => {
    expect(hasRole(ctx("MEMBER"), "ADMIN")).toBe(false);
    expect(hasRole(ctx("ADMIN"), "ADMIN")).toBe(true);
    expect(hasRole(ctx("OWNER"), "ADMIN")).toBe(true);
    expect(hasRole(ctx("ADMIN"), "OWNER")).toBe(false);
  });
});

describe("dashboard metrics", () => {
  it("are computed from records and keep quoted and won values separate", async () => {
    const p = await createProspect(wsB, userId, { ...base, businessName: "Won Co", websiteUrl: "won.example" });
    await db.deal.create({ data: { workspaceId: wsB, prospectId: p.id, title: "Won", stage: "WON", value: 500, currency: "USD", closedAt: new Date() } });
    const proposal = await db.proposal.create({ data: { workspaceId: wsB, prospectId: p.id, title: "P" } });
    await db.proposalVersion.create({ data: { proposalId: proposal.id, version: 1, monthlyPrice: 300, setupFee: 200, currency: "USD" } });

    // 6 paginated + B1 from the merge test + Won Co
    const d = await getDashboardData(wsB);
    expect(d.kpis.totalProspects).toBe(8);
    expect(d.kpis.dealsWon).toBe(1);
    expect(d.kpis.won).toEqual({ USD: 500 });
    expect(d.kpis.quoted).toEqual({ USD: 500 });
    expect(d.kpis.proposalsGenerated).toBe(1);
    expect(d.kpis.proposalsSent).toBe(0);
    expect(d.prospectsOverTime.reduce((a, b) => a + b.prospects, 0)).toBe(8);
  });
});
