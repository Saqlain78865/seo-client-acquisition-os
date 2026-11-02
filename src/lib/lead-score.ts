import "server-only";
import { db } from "./db";
import { isGbpLink } from "./research/gbp-link";

/**
 * Lead score (0–100): how much a prospect needs help (website and Google profile weaknesses) and
 * how warm they are (replies, proposal views, stage). Every point has a reason that is shown next
 * to the score; nothing is guessed.
 */

export type ScoreInput = {
  status: string;
  doNotContact: boolean;
  websiteUrl: string;
  critical: number;
  high: number;
  audited: boolean;
  rating: number | null;
  reviewCount: number | null;
  hasProfile: boolean;
  reachable: boolean;
  repliedAt: Date | null;
  proposalViews: number;
  proposalSent: boolean;
  lastActivityAt: Date;
};

const CLOSED = ["WON", "LOST", "NOT_INTERESTED"];
const DAY = 86400_000;

export function scoreLead(p: ScoreInput, now = new Date()): { score: number; reasons: string[] } {
  if (p.doNotContact) return { score: 0, reasons: ["Asked not to be contacted"] };
  if (CLOSED.includes(p.status)) return { score: 0, reasons: [p.status === "WON" ? "Already a client" : "Deal closed"] };
  const parts: [number, string][] = [];
  // Need: what we can fix for them.
  if (isGbpLink(p.websiteUrl)) parts.push([20, "No website"]);
  else if (p.audited) {
    const weak = Math.min(p.critical * 6 + p.high * 3, 25);
    const issues = [p.critical ? `${p.critical} critical` : "", p.high ? `${p.high} high-impact` : ""].filter(Boolean).join(" and ");
    if (weak) parts.push([weak, `${issues} website issue${p.critical + p.high === 1 ? "" : "s"}`]);
  }
  if (p.hasProfile) {
    if (p.reviewCount != null && p.reviewCount < 20) parts.push([8, `Only ${p.reviewCount} Google reviews`]);
    if (p.rating != null && p.rating < 4) parts.push([7, `Low Google rating (${p.rating.toFixed(1)}★)`]);
  }
  if (p.reachable) parts.push([10, "Email, phone or WhatsApp on file"]);
  // Warmth: how they have responded.
  if (p.repliedAt && now.getTime() - p.repliedAt.getTime() < 30 * DAY) parts.push([25, "Replied in the last 30 days"]);
  else if (p.repliedAt) parts.push([10, "Replied before"]);
  if (p.proposalViews > 0) parts.push([Math.min(5 + p.proposalViews * 3, 15), `Opened the proposal ${p.proposalViews} time${p.proposalViews === 1 ? "" : "s"}`]);
  if (["MEETING_SCHEDULED", "NEGOTIATION"].includes(p.status)) parts.push([15, "Meeting or negotiation stage"]);
  else if (p.proposalSent) parts.push([5, "Proposal sent"]);
  if (now.getTime() - p.lastActivityAt.getTime() > 60 * DAY) parts.push([-10, "No activity for 2 months"]);
  const score = Math.max(0, Math.min(100, parts.reduce((s, [n]) => s + n, 0)));
  return { score, reasons: parts.sort((a, b) => b[0] - a[0]).map(([n, r]) => `${n > 0 ? "+" : ""}${n} ${r}`) };
}

/** Recomputes the score of every open prospect in the workspace (a few queries for all of them). */
export async function refreshLeadScores(workspaceId: string, now = new Date()) {
  const prospects = await db.prospect.findMany({
    where: { workspaceId },
    select: {
      id: true,
      status: true,
      doNotContact: true,
      websiteUrl: true,
      repliedAt: true,
      lastActivityAt: true,
      leadScore: true,
      leadScoreReasons: true,
      contacts: { where: { type: { in: ["EMAIL", "PHONE", "WHATSAPP"] } }, select: { id: true }, take: 1 },
      audits: { where: { status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { findings: { where: { severity: { in: ["CRITICAL", "HIGH"] }, resolutionStatus: { not: "DISMISSED" } }, select: { severity: true } } } },
      gbpProfiles: { orderBy: { fetchedAt: "desc" }, take: 1, select: { rating: true, reviewCount: true } },
      proposals: { select: { shareViews: true, status: true } },
    },
  });
  for (const p of prospects) {
    const findings = p.audits[0]?.findings ?? [];
    const { score, reasons } = scoreLead(
      {
        status: p.status,
        doNotContact: p.doNotContact,
        websiteUrl: p.websiteUrl,
        audited: p.audits.length > 0,
        critical: findings.filter((f) => f.severity === "CRITICAL").length,
        high: findings.filter((f) => f.severity === "HIGH").length,
        hasProfile: p.gbpProfiles.length > 0,
        rating: p.gbpProfiles[0]?.rating ?? null,
        reviewCount: p.gbpProfiles[0]?.reviewCount ?? null,
        reachable: p.contacts.length > 0,
        repliedAt: p.repliedAt,
        proposalViews: p.proposals.reduce((s, x) => s + x.shareViews, 0),
        proposalSent: p.proposals.some((x) => ["SENT", "ACCEPTED", "DECLINED"].includes(x.status)),
        lastActivityAt: p.lastActivityAt,
      },
      now,
    );
    // Written only when it changed.
    if (p.leadScore !== score || JSON.stringify(p.leadScoreReasons) !== JSON.stringify(reasons)) await db.prospect.update({ where: { id: p.id }, data: { leadScore: score, leadScoreReasons: reasons } });
  }
  return prospects.length;
}

export async function runLeadScores() {
  const ws = await db.workspace.findMany({ select: { id: true } });
  for (const w of ws) await refreshLeadScores(w.id);
}
