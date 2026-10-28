import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import { logger } from "./log";
import { notify } from "./notifications";
import { resolveSender } from "./messaging/email";
import { batchSendPreview, sendOneProposal } from "./messaging/bulk-send";

const log = logger("campaigns");

export class CampaignError extends Error {}

export const MAX_DAILY_LIMIT = 50;
/** Emails go out during working hours only (the PC's local time), spread across the day. */
export const SEND_HOURS = { from: 9, to: 18 };
// Clients who have answered or moved on are never emailed by a campaign.
const STOP_STATUSES = new Set(["MEETING_SCHEDULED", "NEGOTIATION", "WON", "LOST", "NOT_INTERESTED"]);

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Starts auto-send for a bulk audit: the person approves the list once; the proposals that are
 * ready (an email address, not sent yet) are queued and sent up to `dailyLimit` a day.
 */
export async function createCampaign(workspaceId: string, userId: string, input: { batchId: string; proposalIds: string[]; dailyLimit: number; name?: string }) {
  if (!(await resolveSender(workspaceId))) throw new CampaignError("Connect Gmail on the Integrations page first.");
  const batch = await db.auditBatch.findFirst({ where: { id: input.batchId, workspaceId } });
  if (!batch) throw new CampaignError("Bulk audit not found.");
  const dailyLimit = Math.round(input.dailyLimit);
  if (!(dailyLimit >= 1 && dailyLimit <= MAX_DAILY_LIMIT)) throw new CampaignError(`Choose between 1 and ${MAX_DAILY_LIMIT} emails a day.`);
  const chosen = new Set(input.proposalIds);
  const ready = (await batchSendPreview(workspaceId, batch.id)).filter((r) => !r.problem && r.to && chosen.has(r.proposalId));
  if (!ready.length) throw new CampaignError("None of the chosen proposals can be emailed (no address, or already sent).");
  // One campaign per proposal at a time.
  const busy = new Set(
    (await db.campaignRecipient.findMany({ where: { proposalId: { in: ready.map((r) => r.proposalId) }, status: "QUEUED", campaign: { status: { in: ["ACTIVE", "PAUSED"] } } }, select: { proposalId: true } })).map((r) => r.proposalId),
  );
  const queue = ready.filter((r) => !busy.has(r.proposalId));
  if (!queue.length) throw new CampaignError("These proposals are already in an auto-send campaign.");
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      batchId: batch.id,
      name: input.name?.trim().slice(0, 120) || `Auto-send: ${batch.name}`,
      dailyLimit,
      createdById: userId,
      recipients: { create: queue.map((r, i) => ({ proposalId: r.proposalId, email: r.to!, sortOrder: i })) },
    },
    include: { _count: { select: { recipients: true } } },
  });
  await logActivity({ workspaceId, userId, type: "campaign.started", message: `Auto-send started: ${campaign._count.recipients} proposals, up to ${dailyLimit} a day` });
  return campaign;
}

export async function setCampaignStatus(workspaceId: string, campaignId: string, status: "ACTIVE" | "PAUSED" | "STOPPED") {
  const c = await db.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!c) throw new CampaignError("Campaign not found.");
  if (c.status === "DONE" || c.status === "STOPPED") throw new CampaignError("This campaign has ended.");
  if (status === "STOPPED") await db.campaignRecipient.updateMany({ where: { campaignId, status: "QUEUED" }, data: { status: "SKIPPED", reason: "Campaign stopped" } });
  return db.campaign.update({ where: { id: campaignId }, data: { status } });
}

export async function listCampaigns(workspaceId: string) {
  const campaigns = await db.campaign.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 30 });
  const today = startOfDay(new Date());
  return Promise.all(
    campaigns.map(async (c) => {
      const counts = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: c.id }, _count: { _all: true } });
      const n = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
      const sentToday = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "SENT", sentAt: { gte: today } } });
      return { ...c, queued: n("QUEUED"), sent: n("SENT"), skipped: n("SKIPPED"), failed: n("FAILED"), sentToday };
    }),
  );
}

export async function campaignRecipients(workspaceId: string, campaignId: string) {
  return db.campaignRecipient.findMany({
    where: { campaignId, campaign: { workspaceId } },
    orderBy: [{ sortOrder: "asc" }],
    include: { proposal: { select: { id: true, prospect: { select: { id: true, businessName: true, domain: true } } } } },
  });
}

/** Why a queued proposal must not be emailed now, or null. */
async function stopReason(proposalId: string) {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { status: true, prospect: { select: { status: true, doNotContact: true } }, _count: { select: { responses: true } } },
  });
  if (!p) return "Proposal deleted";
  if (p.prospect.doNotContact) return "Client opted out";
  if (p._count.responses > 0 || p.status === "ACCEPTED" || p.status === "DECLINED") return "Client already responded";
  if (STOP_STATUSES.has(p.prospect.status)) return "Client moved on in the pipeline";
  return null;
}

/**
 * One tick of auto-send (runs every few minutes): each active campaign sends at most one email,
 * only in working hours, under its daily limit and spaced through the day. Gmail errors pause the
 * campaign so a broken connection is not retried all day.
 */
export async function runCampaigns(now = new Date()) {
  const hour = now.getHours();
  if (hour < SEND_HOURS.from || hour >= SEND_HOURS.to) return { sent: 0 };
  const today = startOfDay(now);
  const active = await db.campaign.findMany({ where: { status: "ACTIVE" } });
  let sent = 0;
  for (const c of active) {
    const sentToday = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "SENT", sentAt: { gte: today } } });
    if (sentToday >= c.dailyLimit) continue;
    const gapMs = Math.max(5 * 60_000, ((SEND_HOURS.to - SEND_HOURS.from) * 3_600_000) / c.dailyLimit);
    if (c.lastSentAt && now.getTime() - c.lastSentAt.getTime() < gapMs * 0.9) continue;

    // Skip the ones that should no longer be emailed, then send the next one.
    for (;;) {
      const next = await db.campaignRecipient.findFirst({ where: { campaignId: c.id, status: "QUEUED" }, orderBy: { sortOrder: "asc" } });
      if (!next) {
        await db.campaign.update({ where: { id: c.id }, data: { status: "DONE" } });
        const total = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "SENT" } });
        await notify({ workspaceId: c.workspaceId, userId: c.createdById, title: `Auto-send finished: ${c.name}`, body: `${total} proposal${total === 1 ? "" : "s"} emailed.`, link: `/campaigns` });
        break;
      }
      const reason = await stopReason(next.proposalId);
      if (reason) {
        await db.campaignRecipient.update({ where: { id: next.id }, data: { status: "SKIPPED", reason } });
        continue;
      }
      if (!c.createdById) {
        await db.campaign.update({ where: { id: c.id }, data: { status: "PAUSED" } });
        break;
      }
      const r = await sendOneProposal(c.workspaceId, c.createdById, next.proposalId);
      if (r.ok) {
        await db.campaignRecipient.update({ where: { id: next.id }, data: { status: "SENT", sentAt: now, reason: r.message === "Already sent" ? "Was already sent" : null } });
        await db.campaign.update({ where: { id: c.id }, data: { lastSentAt: now } });
        sent++;
      } else if (/gmail|smtp|password|login|connect/i.test(r.message)) {
        // The email account itself failed: pause rather than fail every proposal.
        await db.campaign.update({ where: { id: c.id }, data: { status: "PAUSED" } });
        await notify({ workspaceId: c.workspaceId, userId: c.createdById, title: `Auto-send paused: ${c.name}`, body: `${r.message} Fix it, then press Resume.`, link: `/campaigns` });
        log.warn("campaign paused", { campaignId: c.id, reason: r.message });
      } else {
        await db.campaignRecipient.update({ where: { id: next.id }, data: { status: "FAILED", reason: r.message } });
        continue;
      }
      break;
    }
  }
  return { sent };
}
