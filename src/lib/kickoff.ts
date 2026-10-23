import "server-only";
import { db } from "./db";
import { logActivity, ACTIVITY_TYPES } from "./activity";
import type { ServiceKey } from "./proposals/types";

/**
 * When a client says yes, the work starts with the same steps every time: welcome, access,
 * baseline, first fixes, first report. The checklist is built from the accepted proposal's
 * services and its top findings, so it matches what was promised.
 */
export function kickoffTemplate(services: ServiceKey[], firstFixes: string[]) {
  const has = (s: ServiceKey) => services.includes(s);
  return [
    { title: "Send a welcome message and confirm the start date", detail: "Thank them, confirm the scope and the main contact on both sides." },
    { title: "Book the kick-off call", detail: "Goals, priority services and areas, access, reporting day." },
    { title: "Get Google Search Console access", detail: "Full user, or owner adds your email." },
    { title: "Get Google Analytics 4 access (or set it up)", detail: "Track calls, forms and WhatsApp clicks as conversions." },
    { title: "Get website / CMS access or a developer contact", detail: "Needed for technical and on-page changes." },
    ...(has("LOCAL") ? [{ title: "Get manager access to the Google Business Profile", detail: "Profile → Business profile settings → Managers → add your email." }] : []),
    { title: "Record the baseline", detail: "Rankings for priority searches, organic clicks, calls and enquiries — before any change." },
    ...firstFixes.slice(0, 3).map((f) => ({ title: `First fix: ${f}`, detail: "High-priority item from the proposal." })),
    ...(has("REPUTATION") ? [{ title: "Set up the review request link and QR code", detail: "Share it with the client's team; start replying to existing reviews." }] : []),
    ...(has("KEYWORDS") ? [{ title: "Confirm the target keyword list", detail: "Agree the searches and pages from the proposal." }] : []),
    { title: "Schedule the first monthly report", detail: "Same day every month; first one covers the work done and the baseline." },
  ];
}

/** Creates the checklist once per prospect (an existing one is kept as it is). */
export async function ensureKickoff(workspaceId: string, prospectId: string, opts: { dealId?: string | null; proposalId?: string | null } = {}) {
  const existing = await db.kickoffTask.count({ where: { prospectId } });
  if (existing) return { created: 0 };
  let services: ServiceKey[] = ["TECHNICAL", "ONPAGE", "KEYWORDS", "REPORTING"];
  let firstFixes: string[] = [];
  const proposal = opts.proposalId
    ? await db.proposal.findFirst({ where: { id: opts.proposalId, workspaceId } })
    : await db.proposal.findFirst({ where: { prospectId, workspaceId }, orderBy: [{ acceptedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] });
  if (proposal) {
    const version = await db.proposalVersion.findUnique({
      where: { proposalId_version: { proposalId: proposal.id, version: proposal.shareVersion ?? proposal.currentVersion } },
      include: { sections: { where: { key: "key_findings" } } },
    });
    if (version) {
      services = (version.services as ServiceKey[]) ?? services;
      const findings = (version.sections[0]?.data as { findings?: { title: string; priority: string }[] } | null)?.findings ?? [];
      firstFixes = findings.filter((f) => f.priority === "High").map((f) => f.title);
      if (!firstFixes.length) firstFixes = findings.slice(0, 2).map((f) => f.title);
    }
  }
  const tasks = kickoffTemplate(services, firstFixes);
  await db.kickoffTask.createMany({
    data: tasks.map((t, i) => ({ workspaceId, prospectId, dealId: opts.dealId ?? null, title: t.title.slice(0, 200), detail: t.detail, sortOrder: i })),
  });
  return { created: tasks.length };
}

export async function setKickoffTaskDone(workspaceId: string, taskId: string, done: boolean) {
  const task = await db.kickoffTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!task) return null;
  return db.kickoffTask.update({ where: { id: taskId }, data: { done, doneAt: done ? new Date() : null } });
}

/**
 * Records a won deal for the prospect (updating an open one), moves the prospect to Won and
 * prepares the kickoff checklist. Used when the client accepts online.
 */
export async function markWon(workspaceId: string, prospectId: string, opts: { proposalId?: string | null; reason: string; userId?: string | null }) {
  const prospect = await db.prospect.findFirstOrThrow({ where: { id: prospectId, workspaceId } });
  const open = await db.deal.findFirst({ where: { prospectId, stage: "OPEN" } });
  const data = { stage: "WON", value: prospect.wonValue ?? prospect.estimatedValue, currency: prospect.currency, closedAt: new Date(), lostReason: null, proposalId: opts.proposalId ?? open?.proposalId ?? null };
  const deal = open
    ? await db.deal.update({ where: { id: open.id }, data })
    : (await db.deal.findFirst({ where: { prospectId, stage: "WON" } })) ?? (await db.deal.create({ data: { ...data, workspaceId, prospectId, title: `${prospect.businessName} — SEO` } }));
  if (prospect.status !== "WON") {
    await db.prospect.update({ where: { id: prospectId }, data: { status: "WON", lastActivityAt: new Date() } });
    await logActivity({ workspaceId, prospectId, userId: opts.userId ?? null, type: ACTIVITY_TYPES.DEAL_WON, message: `Deal won — ${opts.reason}`, metadata: { dealId: deal.id } });
  }
  const kickoff = await ensureKickoff(workspaceId, prospectId, { dealId: deal.id, proposalId: opts.proposalId });
  return { deal, kickoffCreated: kickoff.created };
}
