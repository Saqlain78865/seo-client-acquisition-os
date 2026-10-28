import "server-only";
import { db } from "./db";
import { followUpDraft } from "./messaging/followup";
import { clickToChatUrl } from "./messaging/whatsapp";
import { shareState, shareUrl } from "./messaging/share";
import { countryCode, countryFromDomain, whatsAppNumbers } from "./phone";

/**
 * "Who to contact today": prospects ranked by real signals saved in the workspace — a question or
 * acceptance on the proposal link, a recent read of the proposal, a reminder that is due, or a
 * proposal nobody has opened. Each row says why it is listed; nothing here is sent automatically.
 */

export type TodayReason = "RESPONDED" | "READING" | "DUE" | "UNOPENED";

export type TodayItem = {
  prospectId: string;
  businessName: string;
  domain: string;
  proposalId: string | null;
  reason: TodayReason;
  /** One line for the user: what happened and when. */
  why: string;
  score: number;
  /** Ready follow-up chat (wa.me), when the website lists a WhatsApp-capable number. */
  whatsappUrl: string | null;
  hasEmail: boolean;
};

const CLOSED = ["WON", "LOST", "NOT_INTERESTED"];
const DAY = 86400_000;

const SECTION_NAMES: Record<string, string> = {
  what_you_get: "what they get",
  deliverables: "pricing and deliverables",
  acceptance: "the acceptance part",
  roadmap: "the plan",
  key_findings: "the findings",
  audit_overview: "their website screenshots",
  gbp: "the Google profile part",
  competitors: "competitors",
  keywords: "keywords",
};

function ago(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export async function todayList(workspaceId: string, now = new Date(), limit = 8): Promise<TodayItem[]> {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId }, select: { consultantName: true, companyName: true } });

  const proposals = await db.proposal.findMany({
    where: { workspaceId, status: { in: ["SENT", "ACCEPTED"] }, prospect: { doNotContact: false, status: { notIn: CLOSED } } },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: {
      id: true,
      status: true,
      shareToken: true,
      shareRevoked: true,
      shareExpiresAt: true,
      shareVersion: true,
      currentVersion: true,
      shareViews: true,
      prospect: { select: { id: true, businessName: true, domain: true, country: true, contacts: { select: { type: true, value: true, sourceMethod: true } } } },
      responses: { where: { createdAt: { gte: new Date(now.getTime() - 14 * DAY) } }, orderBy: { createdAt: "desc" }, take: 1, select: { kind: true, name: true, createdAt: true } },
      readSessions: { where: { lastSeenAt: { gte: new Date(now.getTime() - 3 * DAY) } }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true, totalMs: true, sections: true } },
      emailDeliveries: { where: { status: "ACCEPTED" }, orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } },
      whatsappDeliveries: { where: { status: { in: ["SENT", "DELIVERED", "READ", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const due = await db.followUp.findMany({
    where: { workspaceId, status: "PENDING", dueAt: { lte: endOfToday }, prospect: { doNotContact: false, status: { notIn: CLOSED } } },
    orderBy: { dueAt: "asc" },
    take: 100,
    select: { dueAt: true, note: true, proposalId: true, prospect: { select: { id: true, businessName: true, domain: true, country: true, contacts: { select: { type: true, value: true, sourceMethod: true } } } } },
  });

  const byProspect = new Map<string, TodayItem>();
  const put = (item: TodayItem) => {
    const old = byProspect.get(item.prospectId);
    if (!old || old.score < item.score) byProspect.set(item.prospectId, item);
  };
  const contactBits = (p: { businessName: string; domain: string; country: string | null; contacts: { type: string; value: string; sourceMethod: string | null }[] }, share: string | null) => {
    const wa = whatsAppNumbers(p.contacts, countryCode(p.country) ?? countryFromDomain(p.domain)).find((n) => n.whatsapp !== "NO");
    const person = p.contacts.find((c) => c.type === "PERSON_NAME");
    const draft = followUpDraft({ firstName: person?.value.split(" ")[0] ?? null, businessName: p.businessName, sentOn: null, shareLink: share, findingsSummary: "", consultantName: settings?.consultantName ?? null, companyName: settings?.companyName ?? null });
    return { whatsappUrl: wa ? clickToChatUrl(wa.value, draft.whatsapp) : null, hasEmail: p.contacts.some((c) => c.type === "EMAIL") };
  };

  for (const pr of proposals) {
    const share = shareState(pr) === "ACTIVE" && pr.shareVersion === pr.currentVersion ? shareUrl(pr.shareToken!) : null;
    const base = { prospectId: pr.prospect.id, businessName: pr.prospect.businessName, domain: pr.prospect.domain, proposalId: pr.id };
    const resp = pr.responses[0];
    if (resp) {
      const t = now.getTime() - resp.createdAt.getTime();
      put({ ...base, ...contactBits(pr.prospect, share), reason: "RESPONDED", score: 100 - t / DAY, why: resp.kind === "ACCEPT" ? `${resp.name} accepted the proposal ${ago(t)} — confirm next steps` : `${resp.name} asked a question ${ago(t)} — reply today` });
      continue;
    }
    const read = pr.readSessions[0];
    if (read && pr.status === "SENT") {
      const totalMs = pr.readSessions.reduce((s, r) => s + r.totalMs, 0);
      const sections: Record<string, number> = {};
      for (const r of pr.readSessions) for (const [k, ms] of Object.entries((r.sections ?? {}) as Record<string, number>)) sections[k] = (sections[k] ?? 0) + (Number(ms) || 0);
      const top = Object.entries(sections).sort((a, b) => b[1] - a[1])[0];
      const mins = Math.round(totalMs / 60_000);
      const t = now.getTime() - read.lastSeenAt.getTime();
      const focus = top && top[1] > 20_000 && SECTION_NAMES[top[0]] ? `, mostly ${SECTION_NAMES[top[0]]}` : "";
      put({ ...base, ...contactBits(pr.prospect, share), reason: "READING", score: 80 + Math.min(mins, 10) - t / (6 * 3600_000), why: `Read your proposal ${ago(t)}${mins ? ` (${mins} min${focus})` : ""} — good moment to call` });
      continue;
    }
    const sentAt = [pr.emailDeliveries[0]?.sentAt, pr.whatsappDeliveries[0]?.createdAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    if (sentAt && pr.status === "SENT" && pr.shareViews === 0) {
      const days = Math.floor((now.getTime() - sentAt.getTime()) / DAY);
      if (days >= 4 && days <= 30) put({ ...base, ...contactBits(pr.prospect, share), reason: "UNOPENED", score: 30 - days / 2, why: `Sent ${days} days ago and not opened yet — try another channel` });
    }
  }
  for (const f of due) {
    const late = Math.floor((now.getTime() - f.dueAt.getTime()) / DAY);
    put({
      prospectId: f.prospect.id,
      businessName: f.prospect.businessName,
      domain: f.prospect.domain,
      proposalId: f.proposalId,
      ...contactBits(f.prospect, null),
      reason: "DUE",
      score: 60 + Math.min(late, 10),
      why: late > 0 ? `Follow-up overdue by ${late} day${late === 1 ? "" : "s"}` : f.note?.slice(0, 90) || "Follow-up due today",
    });
  }
  return [...byProspect.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
