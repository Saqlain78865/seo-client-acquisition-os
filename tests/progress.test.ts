import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { progressReport, runMonthlyReaudits } from "@/lib/progress";
import { runnerOptions } from "@/lib/audit/runner";

const DAY = 86400_000;

describe("won-client progress", () => {
  it("compares the first and latest audits, and re-audits won clients once a month", async () => {
    const user = await db.user.create({ data: { email: `prog${Date.now()}@test.example`, name: "P", passwordHash: "x" } });
    const ws = await createWorkspace("Progress WS", user.id);
    const client = await createProspect(ws.id, user.id, { businessName: "Sand Tours", websiteUrl: "http://127.0.0.1:9/", currency: "AED" });
    const audit = (daysAgo: number, findings: [string, string][]) =>
      db.websiteAudit.create({
        data: {
          workspaceId: ws.id,
          prospectId: client.id,
          inputUrl: client.websiteUrl,
          normalizedUrl: client.websiteUrl,
          status: "COMPLETED",
          createdAt: new Date(Date.now() - daysAgo * DAY),
          completedAt: new Date(Date.now() - daysAgo * DAY),
          findings: { create: findings.map(([ruleId, severity]) => ({ ruleId, severity, title: ruleId, category: "TECHNICAL", evidenceStatus: "CONFIRMED", affectedUrls: [], observedFacts: "", recommendation: "" })) },
        },
      });

    const first = await audit(70, [["tech.missing-title", "HIGH"], ["cro.no-click-to-call-home", "MEDIUM"], ["tech.slow", "CRITICAL"]]);
    expect(await progressReport(ws.id, client.id)).toBeNull();
    const last = await audit(35, [["tech.slow", "HIGH"], ["local.no-map", "LOW"]]);
    await db.performanceTest.createMany({
      data: [
        { workspaceId: ws.id, prospectId: client.id, auditId: first.id, url: client.websiteUrl, strategy: "MOBILE", performanceScore: 38 },
        { workspaceId: ws.id, prospectId: client.id, auditId: last.id, url: client.websiteUrl, strategy: "MOBILE", performanceScore: 71 },
      ],
    });

    const r = (await progressReport(ws.id, client.id))!;
    expect(r.fixed.map((f) => f.ruleId)).toEqual(["tech.missing-title", "cro.no-click-to-call-home"]);
    expect(r.remaining.map((f) => f.ruleId)).toEqual(["tech.slow"]);
    expect(r.newIssues.map((f) => f.ruleId)).toEqual(["local.no-map"]);
    expect(r.severity.find((s) => s.key === "CRITICAL")).toEqual({ key: "CRITICAL", before: 1, now: 0 });
    expect(r.speed).toEqual({ before: 38, now: 71 });

    // Not won yet: no re-audit. Won with a 35-day-old audit: one is queued, and only once.
    runnerOptions.allowPrivateNetworks = true;
    const count = () => db.websiteAudit.count({ where: { prospectId: client.id } });
    await runMonthlyReaudits();
    expect(await count()).toBe(2);
    await db.prospect.update({ where: { id: client.id }, data: { status: "WON" } });
    await runMonthlyReaudits();
    expect(await count()).toBe(3);
    const queued = await db.websiteAudit.findFirst({ where: { prospectId: client.id }, orderBy: { createdAt: "desc" } });
    expect(queued?.context).toMatchObject({ reaudit: true });
    await runMonthlyReaudits();
    expect(await count()).toBe(3);
    expect((await db.prospect.findUnique({ where: { id: client.id } }))!.status).toBe("WON");
    runnerOptions.allowPrivateNetworks = false;
  }, 60_000);
});
