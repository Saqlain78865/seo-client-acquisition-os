import "server-only";
import { db } from "./db";

const AWAITING_STATUSES = ["PROPOSAL_SENT", "FOLLOW_UP_DUE"];
const MEETING_OR_LATER = ["MEETING_SCHEDULED", "NEGOTIATION", "WON"];

export type MoneyByCurrency = Record<string, number>;

function addMoney(acc: MoneyByCurrency, currency: string, value: number | null | undefined) {
  if (value == null) return;
  acc[currency] = (acc[currency] ?? 0) + value;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

export async function getDashboardData(workspaceId: string) {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(startOfWeek(now).getTime() + 7 * 86400_000 - 1);
  const weeksBack = 12;
  const chartStart = new Date(startOfWeek(now).getTime() - (weeksBack - 1) * 7 * 86400_000);

  const [
    totalProspects,
    auditsCompleted,
    proposals,
    awaiting,
    followUpsDue,
    deals,
    prospectsForChart,
    bySource,
    emailByStatus,
    waByStatus,
    pipeline,
    followUpsThisWeek,
    recentActivity,
    prospectsWithAudit,
    statusHistory,
    prospectStatuses,
  ] = await Promise.all([
    db.prospect.count({ where: { workspaceId } }),
    db.websiteAudit.count({ where: { workspaceId, status: { in: ["COMPLETED", "PARTIAL"] } } }),
    db.proposal.findMany({
      where: { workspaceId },
      select: {
        status: true,
        prospectId: true,
        currentVersion: true,
        versions: { select: { version: true, monthlyPrice: true, setupFee: true, currency: true } },
        _count: { select: { emailDeliveries: { where: { status: "ACCEPTED" } }, whatsappDeliveries: { where: { status: { in: ["ACCEPTED", "SENT", "DELIVERED", "READ"] } } } } },
      },
    }),
    db.prospect.count({ where: { workspaceId, status: { in: AWAITING_STATUSES } } }),
    db.followUp.count({ where: { workspaceId, status: "PENDING", dueAt: { lte: endOfToday } } }),
    db.deal.findMany({ where: { workspaceId, stage: { in: ["WON", "LOST"] } }, select: { stage: true, value: true, currency: true } }),
    db.prospect.findMany({ where: { workspaceId, createdAt: { gte: chartStart } }, select: { createdAt: true } }),
    db.prospect.groupBy({ by: ["leadSource"], where: { workspaceId }, _count: { _all: true } }),
    db.emailDelivery.groupBy({ by: ["status"], where: { proposal: { workspaceId } }, _count: { _all: true } }),
    db.whatsAppDelivery.groupBy({ by: ["status"], where: { proposal: { workspaceId } }, _count: { _all: true } }),
    db.prospect.groupBy({ by: ["status", "currency"], where: { workspaceId }, _sum: { estimatedValue: true }, _count: { _all: true } }),
    db.followUp.findMany({
      where: { workspaceId, status: "PENDING", dueAt: { lte: endOfWeek } },
      orderBy: { dueAt: "asc" },
      take: 8,
      include: { prospect: { select: { id: true, businessName: true } } },
    }),
    db.activityLog.findMany({
      where: { workspaceId, prospectId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { prospectId: true, createdAt: true },
    }),
    db.websiteAudit.findMany({ where: { workspaceId }, distinct: ["prospectId"], select: { prospectId: true } }),
    db.activityLog.findMany({ where: { workspaceId, type: "prospect.status_changed" }, select: { prospectId: true, metadata: true } }),
    db.prospect.findMany({ where: { workspaceId }, select: { id: true, status: true } }),
  ]);

  // Proposal value = the latest version's setup fee + first month. Proposed value is never mixed with won revenue.
  const quoted: MoneyByCurrency = {};
  let proposalsSent = 0;
  const prospectsWithProposal = new Set<string>();
  const prospectsWithSentProposal = new Set<string>();
  for (const p of proposals) {
    prospectsWithProposal.add(p.prospectId);
    const latest = p.versions.find((v) => v.version === p.currentVersion);
    if (latest && (latest.monthlyPrice != null || latest.setupFee != null)) {
      addMoney(quoted, latest.currency, (latest.monthlyPrice ?? 0) + (latest.setupFee ?? 0));
    }
    const sent = p.status === "SENT" || p.status === "ACCEPTED" || p.status === "DECLINED" || p._count.emailDeliveries + p._count.whatsappDeliveries > 0;
    if (sent) {
      proposalsSent++;
      prospectsWithSentProposal.add(p.prospectId);
    }
  }

  const won: MoneyByCurrency = {};
  let dealsWon = 0;
  let dealsLost = 0;
  for (const d of deals) {
    if (d.stage === "WON") {
      dealsWon++;
      addMoney(won, d.currency, d.value);
    } else dealsLost++;
  }

  // Conversion funnel: a prospect "reached" a stage if its current status or any recorded status change hit it.
  const reached = new Map<string, Set<string>>();
  for (const p of prospectStatuses) reached.set(p.id, new Set([p.status]));
  for (const h of statusHistory) {
    const to = (h.metadata as { to?: string } | null)?.to;
    if (h.prospectId && to) reached.get(h.prospectId)?.add(to);
  }
  const auditedIds = new Set(prospectsWithAudit.map((a) => a.prospectId));
  const auditedWithProposal = [...auditedIds].filter((id) => prospectsWithProposal.has(id)).length;
  const sentReachedMeeting = [...prospectsWithSentProposal].filter((id) => MEETING_OR_LATER.some((s) => reached.get(id)?.has(s))).length;
  const sentWon = [...prospectsWithSentProposal].filter((id) => reached.get(id)?.has("WON")).length;
  const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 100));

  const weeks = Array.from({ length: weeksBack }, (_, i) => {
    const start = new Date(chartStart.getTime() + i * 7 * 86400_000);
    return { start, label: start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), prospects: 0 };
  });
  for (const p of prospectsForChart) {
    const idx = Math.floor((p.createdAt.getTime() - chartStart.getTime()) / (7 * 86400_000));
    if (weeks[idx]) weeks[idx].prospects++;
  }

  const deliveries = [
    { channel: "Email", accepted: 0, failed: 0, manual: 0 },
    { channel: "WhatsApp", accepted: 0, failed: 0, manual: 0 },
  ];
  for (const r of emailByStatus) {
    if (r.status === "ACCEPTED") deliveries[0].accepted += r._count._all;
    else if (r.status === "FAILED") deliveries[0].failed += r._count._all;
    else if (r.status === "MANUAL_OPENED") deliveries[0].manual += r._count._all;
  }
  for (const r of waByStatus) {
    if (["ACCEPTED", "SENT", "DELIVERED", "READ"].includes(r.status)) deliveries[1].accepted += r._count._all;
    else if (r.status === "FAILED") deliveries[1].failed += r._count._all;
    else if (r.status === "MANUAL_OPENED" || r.status === "MANUAL_SENT") deliveries[1].manual += r._count._all;
  }

  return {
    kpis: {
      totalProspects,
      auditsCompleted,
      proposalsGenerated: proposals.length,
      proposalsSent,
      awaiting,
      followUpsDue,
      dealsWon,
      dealsLost,
      quoted,
      won,
    },
    conversions: [
      { label: "Audit → proposal", rate: rate(auditedWithProposal, auditedIds.size), numerator: auditedWithProposal, denominator: auditedIds.size },
      { label: "Proposal → meeting", rate: rate(sentReachedMeeting, prospectsWithSentProposal.size), numerator: sentReachedMeeting, denominator: prospectsWithSentProposal.size },
      { label: "Proposal → client", rate: rate(sentWon, prospectsWithSentProposal.size), numerator: sentWon, denominator: prospectsWithSentProposal.size },
    ],
    prospectsOverTime: weeks.map(({ label, prospects }) => ({ label, prospects })),
    leadSources: bySource
      .map((r) => ({ source: r.leadSource ?? "Not specified", count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    deliveries,
    pipeline: pipeline.map((r) => ({ status: r.status, currency: r.currency, value: r._sum.estimatedValue ?? 0, count: r._count._all })),
    followUpsThisWeek,
    recentWebsites: await recentWebsites(workspaceId, recentActivity),
  };
}

export type RecentWebsite = { prospectId: string; name: string; domain: string; stage: string; tone: "success" | "danger" | "primary" | "info" | "neutral"; at: Date };

/** The last few websites audited — one line each, showing only where it has got to. */
async function recentWebsites(workspaceId: string, logs: { prospectId: string | null; createdAt: Date }[], limit = 5): Promise<RecentWebsite[]> {
  const lastAt = new Map<string, Date>();
  for (const l of logs) if (l.prospectId && !lastAt.has(l.prospectId)) lastAt.set(l.prospectId, l.createdAt);
  const ids = [...lastAt.keys()].slice(0, limit * 4);
  if (ids.length === 0) return [];
  const prospects = await db.prospect.findMany({
    where: { workspaceId, id: { in: ids }, audits: { some: {} } },
    select: {
      id: true,
      businessName: true,
      domain: true,
      audits: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      proposals: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, shareViews: true } },
    },
  });
  const byId = new Map(prospects.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    const audit = p.audits[0]?.status;
    const proposal = p.proposals[0];
    let stage = "Audit running";
    let tone: RecentWebsite["tone"] = "neutral";
    if (proposal?.status === "ACCEPTED") [stage, tone] = ["Proposal accepted", "success"];
    else if (proposal?.status === "DECLINED") [stage, tone] = ["Proposal declined", "danger"];
    else if (proposal?.status === "SENT") [stage, tone] = [proposal.shareViews > 0 ? "Proposal sent · opened by client" : "Proposal sent", "primary"];
    else if (proposal) [stage, tone] = ["Audit done · proposal ready", "info"];
    else if (audit === "COMPLETED" || audit === "PARTIAL") [stage, tone] = ["Audit done", "info"];
    else if (audit === "FAILED") [stage, tone] = ["Audit failed", "danger"];
    return [{ prospectId: p.id, name: p.businessName, domain: p.domain, stage, tone, at: lastAt.get(id)! }];
  }).slice(0, limit);
}
