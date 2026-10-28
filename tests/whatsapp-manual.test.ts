import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { createProposal } from "@/lib/proposals/service";
import { markSeenOnWhatsApp, markSentOnWhatsApp, whatsAppState } from "@/lib/messaging/manual";
import { SendError } from "@/lib/messaging/service";

async function setup(name: string) {
  const user = await db.user.create({ data: { email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.example`, name, passwordHash: "x" } });
  const ws = await createWorkspace(`${name} WS`, user.id);
  const prospect = await createProspect(ws.id, user.id, { businessName: "Balloon Rides", websiteUrl: `balloon${Date.now()}${name}.example`, currency: "AED", whatsapp: "+44 7911 123456" });
  const proposal = await createProposal(ws.id, user.id, { prospectId: prospect.id });
  return { userId: user.id, workspaceId: ws.id, prospect, proposal };
}

describe("WhatsApp sent / seen marked by hand", () => {
  it("marks a proposal sent from WhatsApp directly, once, with reminders; then seen schedules the follow-up", async () => {
    const { userId, workspaceId, prospect, proposal } = await setup("wamanual");
    await expect(markSeenOnWhatsApp(workspaceId, userId, proposal.id)).rejects.toThrow(SendError);

    const r = await markSentOnWhatsApp(workspaceId, userId, proposal.id);
    expect(r).toMatchObject({ already: false });
    expect(r.followUps).toBeGreaterThan(0);
    expect((await db.proposal.findUnique({ where: { id: proposal.id } }))!.status).toBe("SENT");
    expect((await db.prospect.findUnique({ where: { id: prospect.id } }))!.status).toBe("PROPOSAL_SENT");
    expect((await markSentOnWhatsApp(workspaceId, userId, proposal.id)).already).toBe(true);
    expect(await db.whatsAppDelivery.count({ where: { proposalId: proposal.id } })).toBe(1);
    expect(await whatsAppState(proposal.id)).toMatchObject({ seen: false, recipient: "+447911123456" });

    const f = await markSeenOnWhatsApp(workspaceId, userId, proposal.id);
    expect(f?.url).toMatch(/^https:\/\/wa\.me\/447911123456\?text=/);
    expect(f?.message).toMatch(/following up/);
    expect(await whatsAppState(proposal.id)).toMatchObject({ seen: true });
    await markSeenOnWhatsApp(workspaceId, userId, proposal.id);
    expect(await db.followUp.count({ where: { proposalId: proposal.id, type: "OPENED_NO_REPLY", status: "PENDING" } })).toBe(1);
  });

  it("confirms a chat that was opened from the app instead of adding a second record", async () => {
    const { userId, workspaceId, proposal } = await setup("waopened");
    await db.whatsAppDelivery.create({ data: { proposalId: proposal.id, versionNumber: 1, idempotencyKey: `wa:${proposal.id}:v1:x`, channelMethod: "CLICK_TO_CHAT", recipient: "+447911123456", messagePreview: "hi", status: "MANUAL_OPENED" } });
    await markSentOnWhatsApp(workspaceId, userId, proposal.id);
    const rows = await db.whatsAppDelivery.findMany({ where: { proposalId: proposal.id } });
    expect(rows.map((r) => r.status)).toEqual(["MANUAL_SENT"]);
  });
});
