import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { createProposal } from "@/lib/proposals/service";
import { formatDuration, readBeatSchema, readingSummary, recordReadBeat } from "@/lib/proposals/reading";
import { addTask, boardTasks, moveTask, monthKey, planMonth, shiftMonth, workReport } from "@/lib/client-work";
import { runRules } from "@/lib/audit/rules";
import type { AuditInput } from "@/lib/audit/types";

async function setup(name: string) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  const prospect = await createProspect(ws.id, user.id, { businessName: "Dune Tours", websiteUrl: `dunetours-${name}${Date.now()}.example`, currency: "USD", city: "Dubai", primaryServices: "Buggy tours" });
  return { userId: user.id, workspaceId: ws.id, prospect };
}

describe("proposal reading analytics", () => {
  it("adds up reading time per section across beats and visits", async () => {
    const { userId, workspaceId, prospect } = await setup("read");
    const proposal = await createProposal(workspaceId, userId, { prospectId: prospect.id });
    const beat = (visitorKey: string, sections: Record<string, number>) => readBeatSchema.parse({ visitorKey, device: "DESKTOP", sections });

    await recordReadBeat(proposal.id, 1, beat("visit-aaaa-1", { cover: 4000, key_findings: 6000 }));
    await recordReadBeat(proposal.id, 1, beat("visit-aaaa-1", { key_findings: 9000 }));
    await recordReadBeat(proposal.id, 1, { ...beat("visit-bbbb-2", { deliverables: 5000 }), device: "MOBILE" });
    // Unknown section names and empty beats are ignored; a visit under 3 s is not counted as reading.
    expect(await recordReadBeat(proposal.id, 1, beat("visit-cccc-3", { not_a_section: 5000 }))).toBeNull();
    await recordReadBeat(proposal.id, 1, beat("visit-dddd-4", { cover: 1000 }));

    const s = (await readingSummary(workspaceId, proposal.id))!;
    expect(s.visits).toBe(2);
    expect(s.totalMs).toBe(24_000);
    expect(s.devices).toEqual({ DESKTOP: 1, MOBILE: 1 });
    expect(s.sections[0]).toMatchObject({ key: "key_findings", ms: 15_000 });
    expect(s.decision.find((d) => d.key === "deliverables")!.ms).toBe(5000);
    expect(s.decision.find((d) => d.key === "acceptance")!.ms).toBe(0);
    // Another workspace sees nothing.
    const other = await setup("read-other");
    expect(await readingSummary(other.workspaceId, proposal.id)).toBeNull();
  });

  it("caps an inflated beat instead of trusting it", async () => {
    const { userId, workspaceId, prospect } = await setup("cap");
    const proposal = await createProposal(workspaceId, userId, { prospectId: prospect.id });
    await recordReadBeat(proposal.id, 1, readBeatSchema.parse({ visitorKey: "visit-cap-0001", device: "DESKTOP", sections: { cover: 60_000, glance: 60_000 } }));
    expect((await readingSummary(workspaceId, proposal.id))!.totalMs).toBe(30_000);
    expect(readBeatSchema.safeParse({ visitorKey: "x", device: "DESKTOP", sections: {} }).success).toBe(false);
    expect(readBeatSchema.safeParse({ visitorKey: "visit-cap-0001", device: "TV", sections: {} }).success).toBe(false);
  });

  it("formats durations for people", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(65_000)).toBe("1 min 05 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
  });
});

describe("client work board", () => {
  it("plans a month from the proposal's deliverables without duplicates, then reports it", async () => {
    const { userId, workspaceId, prospect } = await setup("work");
    const proposal = await createProposal(workspaceId, userId, { prospectId: prospect.id });
    await db.proposalVersion.updateMany({ where: { proposalId: proposal.id }, data: { deliverables: [{ title: "Two blog posts", detail: "Priority keywords" }, { title: "GBP posts", detail: "" }] } });
    const month = monthKey(new Date(2026, 9, 15));
    expect(month).toBe("2026-10");
    expect(shiftMonth(month, 3)).toBe("2027-01");

    const first = await planMonth(workspaceId, userId, prospect.id, month);
    expect(first).toMatchObject({ added: 2, fromProposal: true });
    expect((await planMonth(workspaceId, userId, prospect.id, month)).added).toBe(0);

    const extra = await addTask(workspaceId, prospect.id, month, "Fix broken links");
    await moveTask(workspaceId, extra.id, "DONE");
    const tasks = await boardTasks(workspaceId, month);
    expect(tasks.map((t) => t.title)).toEqual(["Two blog posts", "GBP posts", "Fix broken links"]);
    expect(tasks.find((t) => t.id === extra.id)!.doneAt).not.toBeNull();

    const report = (await workReport(workspaceId, prospect.id, month))!;
    expect(report.done.map((t) => t.title)).toEqual(["Fix broken links"]);
    expect(report.open).toHaveLength(2);
    // Another workspace cannot touch the tasks.
    const other = await setup("work-other");
    await expect(moveTask(other.workspaceId, extra.id, "TODO")).rejects.toThrow("Task not found");
    expect(await workReport(other.workspaceId, prospect.id, month)).toBeNull();
  });

  it("falls back to a standard month when the proposal lists no deliverables", async () => {
    const { userId, workspaceId, prospect } = await setup("work-default");
    const r = await planMonth(workspaceId, userId, prospect.id, "2026-11");
    expect(r.fromProposal).toBe(false);
    expect(r.added).toBeGreaterThan(3);
  });
});

describe("AI search readiness", () => {
  const input = (body: string | null, llms?: AuditInput["llmsTxt"]): AuditInput => ({
    homepageUrl: "https://shop.example/",
    origin: "https://shop.example",
    robots: { found: body != null, status: body == null ? 404 : 200, error: null, body, sitemaps: [], blocksEverything: false, blocksGooglebotHomepage: false },
    sitemaps: { checked: [], urls: [] },
    llmsTxt: llms,
    httpToHttps: { checked: true, redirectsToHttps: true, finalUrl: "https://shop.example/" },
    pages: [],
    skipped: [],
    limitReached: false,
    pageLimit: 20,
    context: {},
    collectedAt: new Date(),
  });
  const find = (i: AuditInput, id: string) => runRules(i).find((f) => f.ruleId === id);

  it("reports blocked AI search crawlers but not blocked training crawlers", () => {
    const blocked = find(input("User-agent: PerplexityBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n"), "ai.search-bots-blocked")!;
    expect(blocked.category).toBe("AI search");
    expect(blocked.observedFacts).toContain("PerplexityBot");
    expect(blocked.observedFacts).toContain("OAI-SearchBot");
    expect(blocked.observedFacts).not.toContain("Claude-SearchBot");
    expect(find(input("User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n"), "ai.search-bots-blocked")).toBeUndefined();
    expect(find(input(null), "ai.search-bots-blocked")).toBeUndefined();
  });

  it("suggests llms.txt only when it was checked and is missing", () => {
    expect(find(input(null, { found: false, status: 404 }), "ai.llms-txt-missing")!.severity).toBe("OPPORTUNITY");
    expect(find(input(null, { found: true, status: 200 }), "ai.llms-txt-missing")).toBeUndefined();
    // Audits from before the check existed make no claim.
    expect(find(input(null), "ai.llms-txt-missing")).toBeUndefined();
  });
});
