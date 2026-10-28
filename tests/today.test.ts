import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { todayList } from "@/lib/today";

const DAY = 86400_000;

describe("Who to contact today", () => {
  it("ranks replies, proposal reads, due reminders and unopened proposals, and skips opted-out or closed prospects", async () => {
    const user = await db.user.create({ data: { email: `today${Date.now()}@test.example`, name: "T", passwordHash: "x" } });
    const ws = await createWorkspace("Today WS", user.id);
    const now = new Date();
    const prospect = (name: string, extra: Record<string, string> = {}) =>
      createProspect(ws.id, user.id, { businessName: name, websiteUrl: `${name.toLowerCase().replace(/\W/g, "")}${Date.now()}.example`, currency: "USD", ...extra });
    const proposal = (prospectId: string, status = "SENT") => db.proposal.create({ data: { workspaceId: ws.id, prospectId, title: "SEO proposal", status } });

    const asked = await prospect("Asked Co", { email: "owner@asked.example", whatsapp: "+44 7911 123456" });
    const askedP = await proposal(asked.id);
    await db.proposalResponse.create({ data: { proposalId: askedP.id, kind: "QUESTION", name: "Omar", version: 1, createdAt: new Date(now.getTime() - 2 * 3600_000) } });

    const reader = await prospect("Reader Co", { email: "hi@reader.example" });
    const readerP = await proposal(reader.id);
    await db.proposalReadSession.create({ data: { proposalId: readerP.id, version: 1, visitorKey: "v1", device: "MOBILE", totalMs: 240_000, sections: { deliverables: 150_000, key_findings: 60_000 }, lastSeenAt: new Date(now.getTime() - 20 * 60_000) } });

    const due = await prospect("Due Co");
    await db.followUp.create({ data: { workspaceId: ws.id, prospectId: due.id, type: "PROPOSAL_REMINDER", dueAt: new Date(now.getTime() - 2 * DAY) } });

    const quiet = await prospect("Quiet Co", { email: "q@quiet.example" });
    const quietP = await proposal(quiet.id);
    await db.emailDelivery.create({ data: { proposalId: quietP.id, versionNumber: 1, idempotencyKey: `t-${quietP.id}`, channelMethod: "GMAIL_API", recipient: "q@quiet.example", subject: "s", status: "ACCEPTED", sentAt: new Date(now.getTime() - 6 * DAY) } });

    const optedOut = await prospect("Stop Co");
    await db.prospect.update({ where: { id: optedOut.id }, data: { doNotContact: true } });
    const stopP = await proposal(optedOut.id);
    await db.proposalResponse.create({ data: { proposalId: stopP.id, kind: "QUESTION", name: "X", version: 1 } });
    const won = await prospect("Won Co");
    await db.prospect.update({ where: { id: won.id }, data: { status: "WON" } });
    await db.followUp.create({ data: { workspaceId: ws.id, prospectId: won.id, type: "CUSTOM", dueAt: now } });

    const list = await todayList(ws.id, now);
    expect(list.map((t) => [t.businessName, t.reason])).toEqual([
      ["Asked Co", "RESPONDED"],
      ["Reader Co", "READING"],
      ["Due Co", "DUE"],
      ["Quiet Co", "UNOPENED"],
    ]);
    expect(list[0].why).toMatch(/Omar asked a question/);
    expect(list[0].whatsappUrl).toMatch(/^https:\/\/wa\.me\/447911123456\?text=/);
    expect(list[1].why).toMatch(/4 min, mostly pricing and deliverables/);
    expect(list[2]).toMatchObject({ why: "Follow-up overdue by 2 days", hasEmail: false, whatsappUrl: null });
    expect(list[3].why).toMatch(/Sent 6 days ago and not opened/);
  });
});
