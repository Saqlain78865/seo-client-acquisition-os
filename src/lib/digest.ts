import "server-only";
import { db } from "./db";
import { logger } from "./log";
import { notify } from "./notifications";
import { EmailError, resolveSender, sendEmail } from "./messaging/email";
import { appUrl } from "./messaging/share";
import { escapeHtml } from "./proposals/render";

const log = logger("digest");
const DAY = 86_400_000;

/**
 * The Monday summary for the workspace owners: what happened with proposals last week and who
 * needs attention now. Every number is counted from saved records.
 */
export async function buildDigest(workspaceId: string, now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY);
  const weekAhead = new Date(now.getTime() + 7 * DAY);
  const [emails, whatsapps, opened, accepted, questions, audits, prospects, won, due, nudges] = await Promise.all([
    db.emailDelivery.count({ where: { proposal: { workspaceId }, status: "ACCEPTED", sentAt: { gte: since } } }),
    db.whatsAppDelivery.count({ where: { proposal: { workspaceId }, status: { in: ["ACCEPTED", "SENT", "DELIVERED", "READ"] }, createdAt: { gte: since } } }),
    db.proposal.findMany({ where: { workspaceId, shareLastViewedAt: { gte: since } }, select: { id: true, prospect: { select: { businessName: true } } } }),
    db.proposal.findMany({ where: { workspaceId, acceptedAt: { gte: since } }, select: { id: true, prospect: { select: { businessName: true } } } }),
    db.proposalResponse.findMany({ where: { kind: "QUESTION", createdAt: { gte: since }, proposal: { workspaceId } }, select: { proposalId: true, name: true, proposal: { select: { prospect: { select: { businessName: true } } } } } }),
    db.websiteAudit.count({ where: { workspaceId, completedAt: { gte: since }, status: { in: ["COMPLETED", "PARTIAL"] } } }),
    db.prospect.count({ where: { workspaceId, createdAt: { gte: since } } }),
    db.deal.count({ where: { workspaceId, stage: "WON", closedAt: { gte: since } } }),
    db.followUp.findMany({
      where: { workspaceId, status: "PENDING", dueAt: { lte: weekAhead } },
      orderBy: { dueAt: "asc" },
      take: 10,
      include: { prospect: { select: { id: true, businessName: true } } },
    }),
    // Opened at least two days ago, not accepted and no reply: a personal follow-up usually helps.
    db.proposal.findMany({
      where: { workspaceId, acceptedAt: null, status: { in: ["SENT", "READY", "DRAFT"] }, shareLastViewedAt: { lte: new Date(now.getTime() - 2 * DAY), gte: new Date(now.getTime() - 30 * DAY) }, responses: { none: {} } },
      select: { id: true, shareViews: true, shareLastViewedAt: true, prospect: { select: { businessName: true } } },
      take: 10,
    }),
  ]);
  return {
    since,
    now,
    sent: emails + whatsapps,
    opened: opened.map((p) => ({ id: p.id, name: p.prospect.businessName })),
    accepted: accepted.map((p) => ({ id: p.id, name: p.prospect.businessName })),
    questions: questions.map((q) => ({ id: q.proposalId, name: q.proposal.prospect.businessName, from: q.name })),
    audits,
    prospects,
    won,
    due: due.map((f) => ({ prospectId: f.prospect.id, name: f.prospect.businessName, dueAt: f.dueAt, proposalId: f.proposalId, overdue: f.dueAt < now })),
    nudges: nudges.map((p) => ({ id: p.id, name: p.prospect.businessName, views: p.shareViews })),
  };
}
export type Digest = Awaited<ReturnType<typeof buildDigest>>;

const day = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function renderDigest(d: Digest, workspaceName: string, base = appUrl()) {
  const stats: [string, number][] = [
    ["Proposals sent", d.sent],
    ["Opened by clients", d.opened.length],
    ["Accepted", d.accepted.length],
    ["Deals won", d.won],
    ["Audits done", d.audits],
    ["New prospects", d.prospects],
  ];
  const subject = `Your week: ${d.opened.length} proposal${d.opened.length === 1 ? "" : "s"} opened, ${d.accepted.length} accepted${d.due.length ? ` · ${d.due.length} follow-up${d.due.length === 1 ? "" : "s"} to do` : ""}`;
  const lines: string[] = [`Weekly summary for ${workspaceName} (${day(d.since)} – ${day(d.now)})`, "", ...stats.map(([l, n]) => `${l}: ${n}`)];
  if (d.accepted.length) lines.push("", "Accepted:", ...d.accepted.map((a) => `- ${a.name} — ${base}/proposals/${a.id}`));
  if (d.questions.length) lines.push("", "Questions waiting for an answer:", ...d.questions.map((q) => `- ${q.name} (${q.from}) — ${base}/proposals/${q.id}`));
  if (d.nudges.length) lines.push("", "Opened but no reply — follow up:", ...d.nudges.map((n) => `- ${n.name} — ${base}/proposals/${n.id}/send?followup=1`));
  if (d.due.length) lines.push("", "Follow-ups this week:", ...d.due.map((f) => `- ${f.name}: ${day(f.dueAt)}${f.overdue ? " (overdue)" : ""}`));
  lines.push("", `Open the app: ${base}`, "", "You get this every Monday. Turn it off in Settings.");

  const list = (title: string, color: string, items: { label: string; href: string; note?: string }[]) =>
    items.length
      ? `<tr><td style="padding:18px 28px 0"><p style="margin:0 0 8px;font:700 13px Arial;color:${color};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(title)}</p>${items
          .map((i) => `<a href="${escapeHtml(i.href)}" style="display:block;margin:0 0 6px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;text-decoration:none;color:#0f172a;font:14px Arial">${escapeHtml(i.label)}${i.note ? `<span style="color:#64748b;font-size:12px"> · ${escapeHtml(i.note)}</span>` : ""}</a>`)
          .join("")}</td></tr>`
      : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#1e1b4b,#4f46e5);padding:26px 28px;color:#fff;font-family:Arial">
<p style="margin:0;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.12em">Weekly summary · ${escapeHtml(workspaceName)}</p>
<p style="margin:8px 0 0;font-size:22px;font-weight:700">${escapeHtml(subject.replace(/^Your week: /, ""))}</p>
<p style="margin:6px 0 0;font-size:13px;opacity:.75">${day(d.since)} – ${day(d.now)}</p></td></tr>
<tr><td style="padding:20px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>${stats
    .map(([l, n], i) => `${i === 3 ? "</tr><tr>" : ""}<td width="33%" style="background:#eef2ff;border-radius:12px;padding:12px 14px;font-family:Arial"><div style="font-size:24px;font-weight:800;color:#1e1b4b">${n}</div><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">${l}</div></td>`)
    .join("")}</tr></table></td></tr>
${list("🎉 Accepted", "#15803d", d.accepted.map((a) => ({ label: a.name, href: `${base}/proposals/${a.id}` })))}
${list("Questions waiting for you", "#4f46e5", d.questions.map((q) => ({ label: q.name, note: q.from, href: `${base}/proposals/${q.id}` })))}
${list("Opened, no reply — send a follow-up", "#b45309", d.nudges.map((n) => ({ label: n.name, note: `${n.views} view${n.views === 1 ? "" : "s"}`, href: `${base}/proposals/${n.id}/send?followup=1` })))}
${list("Follow-ups this week", "#334155", d.due.map((f) => ({ label: f.name, note: `${day(f.dueAt)}${f.overdue ? " · overdue" : ""}`, href: f.proposalId ? `${base}/proposals/${f.proposalId}/send?followup=1` : `${base}/prospects/${f.prospectId}` })))}
<tr><td style="padding:24px 28px 28px;font-family:Arial"><a href="${escapeHtml(base)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:14px">Open the app</a>
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">You get this every Monday. Turn it off in Settings.</p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text: lines.join("\n"), html };
}

/** Sends the summary to the workspace owners and admins. */
export async function sendDigest(workspaceId: string, now = new Date()) {
  const [workspace, members] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }),
    db.workspaceMembership.findMany({ where: { workspaceId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: { select: { email: true } } } }),
  ]);
  const to = [...new Set(members.map((m) => m.user.email))];
  if (!to.length) throw new EmailError("No owner or admin email to send the summary to.", "OTHER");
  const digest = await buildDigest(workspaceId, now);
  const mail = renderDigest(digest, workspace.name);
  await sendEmail(workspaceId, { to: to[0], bcc: to.slice(1), subject: mail.subject, text: mail.text, html: mail.html });
  await db.workspaceSettings.update({ where: { workspaceId }, data: { lastDigestAt: now } });
  return { to, subject: mail.subject };
}

/** Called hourly: on Monday from 08:00 (server time), each workspace with the summary on gets it once. */
export async function runWeeklyDigests(now = new Date()) {
  if (now.getDay() !== 1 || now.getHours() < 8) return 0;
  const due = await db.workspaceSettings.findMany({
    where: { weeklyDigest: true, OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: new Date(now.getTime() - 6 * DAY) } }] },
    select: { workspaceId: true },
  });
  let sent = 0;
  for (const { workspaceId } of due) {
    if (!(await resolveSender(workspaceId))) continue; // no email account connected: nothing to send from
    try {
      await sendDigest(workspaceId, now);
      await notify({ workspaceId, title: "Your weekly summary was emailed", link: "/" });
      sent++;
    } catch (e) {
      log.warn("weekly summary failed", { workspaceId, err: e });
    }
  }
  return sent;
}
