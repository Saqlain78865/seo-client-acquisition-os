import "server-only";
import { db } from "./db";

const DAY = 86400_000;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Workspace analytics computed from saved records only. */
export async function getReports(workspaceId: string, months = 12) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  const [prospects, audits, proposals, deals, findings, emails, whatsapps] = await Promise.all([
    db.prospect.findMany({ where: { workspaceId }, select: { id: true, createdAt: true, leadSource: true, status: true, lostReason: true } }),
    db.websiteAudit.findMany({ where: { workspaceId }, select: { id: true, prospectId: true, status: true, createdAt: true, completedAt: true } }),
    db.proposal.findMany({ where: { workspaceId }, select: { id: true, prospectId: true, status: true, createdAt: true } }),
    db.deal.findMany({ where: { workspaceId }, select: { prospectId: true, stage: true, value: true, currency: true, closedAt: true, lostReason: true, createdAt: true } }),
    db.auditFinding.findMany({
      where: { audit: { workspaceId, status: { in: ["COMPLETED", "PARTIAL"] } }, ruleId: { not: "CUSTOM" }, severity: { not: "NEEDS_VERIFICATION" } },
      select: { ruleId: true, title: true, auditId: true, severity: true },
    }),
    db.emailDelivery.findMany({ where: { proposal: { workspaceId }, status: "ACCEPTED" }, select: { proposalId: true, sentAt: true, createdAt: true } }),
    db.whatsAppDelivery.findMany({ where: { proposal: { workspaceId }, status: { in: ["ACCEPTED", "SENT", "DELIVERED", "READ"] } }, select: { proposalId: true, createdAt: true } }),
  ]);

  // Monthly activity.
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    keys.push(monthKey(d));
  }
  const monthly = new Map(keys.map((k) => [k, { month: k, prospects: 0, audits: 0, proposals: 0, won: 0, lost: 0 }]));
  const bump = (d: Date | null, field: "prospects" | "audits" | "proposals" | "won" | "lost") => {
    if (!d || d < start) return;
    const row = monthly.get(monthKey(d));
    if (row) row[field]++;
  };
  prospects.forEach((p) => bump(p.createdAt, "prospects"));
  audits.filter((a) => a.status === "COMPLETED" || a.status === "PARTIAL").forEach((a) => bump(a.completedAt ?? a.createdAt, "audits"));
  proposals.forEach((p) => bump(p.createdAt, "proposals"));
  deals.forEach((d) => (d.stage === "WON" ? bump(d.closedAt, "won") : d.stage === "LOST" ? bump(d.closedAt, "lost") : null));

  // Lead source performance.
  const sentProposalIds = new Set([...emails.map((e) => e.proposalId), ...whatsapps.map((w) => w.proposalId), ...proposals.filter((p) => ["SENT", "ACCEPTED", "DECLINED"].includes(p.status)).map((p) => p.id)]);
  const prospectsWithSent = new Set(proposals.filter((p) => sentProposalIds.has(p.id)).map((p) => p.prospectId));
  const won = new Set(deals.filter((d) => d.stage === "WON").map((d) => d.prospectId));
  const sources = new Map<string, { source: string; prospects: number; sent: number; won: number }>();
  for (const p of prospects) {
    const key = p.leadSource ?? "Not specified";
    const row = sources.get(key) ?? { source: key, prospects: 0, sent: 0, won: 0 };
    row.prospects++;
    if (prospectsWithSent.has(p.id)) row.sent++;
    if (won.has(p.id)) row.won++;
    sources.set(key, row);
  }

  // Most common confirmed issues across audits.
  const completedAudits = new Set(findings.map((f) => f.auditId));
  const byRule = new Map<string, { ruleId: string; title: string; audits: Set<string> }>();
  for (const f of findings) {
    const r = byRule.get(f.ruleId) ?? { ruleId: f.ruleId, title: f.title, audits: new Set<string>() };
    r.audits.add(f.auditId);
    byRule.set(f.ruleId, r);
  }
  const commonIssues = [...byRule.values()]
    .map((r) => ({ ruleId: r.ruleId, title: r.title, audits: r.audits.size, share: completedAudits.size ? Math.round((r.audits.size / completedAudits.size) * 100) : 0 }))
    .sort((a, b) => b.audits - a.audits)
    .slice(0, 10);

  // Speed of the pipeline.
  const firstProposal = new Map<string, Date>();
  for (const p of proposals) {
    const prev = firstProposal.get(p.prospectId);
    if (!prev || p.createdAt < prev) firstProposal.set(p.prospectId, p.createdAt);
  }
  const auditToProposalDays = audits
    .filter((a) => a.completedAt && firstProposal.get(a.prospectId) && firstProposal.get(a.prospectId)! >= a.completedAt)
    .map((a) => (firstProposal.get(a.prospectId)!.getTime() - a.completedAt!.getTime()) / DAY);
  const proposalToWonDays = deals
    .filter((d) => d.stage === "WON" && d.closedAt && firstProposal.get(d.prospectId))
    .map((d) => (d.closedAt!.getTime() - firstProposal.get(d.prospectId)!.getTime()) / DAY)
    .filter((x) => x >= 0);

  const lostReasons = new Map<string, number>();
  for (const d of deals.filter((d) => d.stage === "LOST" && d.lostReason)) lostReasons.set(d.lostReason!.trim(), (lostReasons.get(d.lostReason!.trim()) ?? 0) + 1);

  const wonValue: Record<string, number> = {};
  for (const d of deals.filter((d) => d.stage === "WON" && d.value != null)) wonValue[d.currency] = (wonValue[d.currency] ?? 0) + d.value!;

  return {
    monthly: [...monthly.values()].map((m) => ({ ...m, label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) })),
    sources: [...sources.values()].sort((a, b) => b.prospects - a.prospects),
    commonIssues,
    completedAudits: completedAudits.size,
    proposalStatus: proposals.reduce<Record<string, number>>((a, p) => ((a[p.status] = (a[p.status] ?? 0) + 1), a), {}),
    medianAuditToProposalDays: median(auditToProposalDays),
    medianProposalToWonDays: median(proposalToWonDays),
    lostReasons: [...lostReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    wonValue,
    totals: { prospects: prospects.length, audits: audits.length, proposals: proposals.length, won: won.size, lost: deals.filter((d) => d.stage === "LOST").length },
  };
}
