import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";
import type { Deliverable } from "./proposals/types";

export const TASK_STATUSES = ["TODO", "DOING", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export class ClientWorkError extends Error {}

/** "2026-10" for a date (local time). */
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** "October 2026". */
export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function shiftMonth(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
}

// Used when the client's proposal lists no monthly deliverables.
const DEFAULT_MONTHLY: Deliverable[] = [
  { title: "Fix the top technical issues from the audit", detail: "Work through the highest-priority findings first." },
  { title: "Improve titles and descriptions on key pages", detail: "Service and location pages first." },
  { title: "Publish new content", detail: "One page or article for a priority keyword." },
  { title: "Google Business Profile update", detail: "Posts, photos and replies to new reviews." },
  { title: "Check rankings and Search Console", detail: "Note what moved and why." },
  { title: "Send the monthly report", detail: "What was done, results and next month's plan." },
];

/** Won clients — the prospects the board is for. */
export async function wonClients(workspaceId: string) {
  return db.prospect.findMany({ where: { workspaceId, status: "WON" }, orderBy: { businessName: "asc" }, select: { id: true, businessName: true, domain: true } });
}

export async function boardTasks(workspaceId: string, month: string, prospectId?: string) {
  return db.clientTask.findMany({
    where: { workspaceId, month, ...(prospectId ? { prospectId } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { prospect: { select: { id: true, businessName: true } } },
  });
}

async function ownedClient(workspaceId: string, prospectId: string) {
  const p = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, select: { id: true, businessName: true } });
  if (!p) throw new ClientWorkError("Client not found.");
  return p;
}

/** The monthly deliverables from the client's accepted proposal (or the latest one). */
export async function proposalDeliverables(workspaceId: string, prospectId: string): Promise<Deliverable[]> {
  const proposal = await db.proposal.findFirst({
    where: { workspaceId, prospectId },
    orderBy: [{ acceptedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    select: { currentVersion: true, shareVersion: true, acceptedAt: true, versions: { select: { version: true, deliverables: true } } },
  });
  if (!proposal) return [];
  // The version the client accepted is the shared one; otherwise the latest draft.
  const wanted = proposal.acceptedAt && proposal.shareVersion ? proposal.shareVersion : proposal.currentVersion;
  const v = proposal.versions.find((x) => x.version === wanted) ?? proposal.versions.at(-1);
  return ((v?.deliverables as Deliverable[] | null) ?? []).filter((d) => d.title?.trim());
}

/**
 * Adds the month's tasks for one client from its proposal's monthly deliverables (or a sensible
 * default list). Tasks already on the board for that month are not added twice.
 */
export async function planMonth(workspaceId: string, userId: string | null, prospectId: string, month: string) {
  const client = await ownedClient(workspaceId, prospectId);
  const fromProposal = await proposalDeliverables(workspaceId, prospectId);
  const source = fromProposal.length ? fromProposal : DEFAULT_MONTHLY;
  const existing = new Set((await db.clientTask.findMany({ where: { prospectId, month }, select: { title: true } })).map((t) => t.title.toLowerCase()));
  const fresh = source.filter((d) => !existing.has(d.title.trim().toLowerCase())).slice(0, 30);
  if (fresh.length) {
    await db.clientTask.createMany({
      data: fresh.map((d, i) => ({ workspaceId, prospectId, month, title: d.title.trim().slice(0, 200), detail: d.detail?.trim().slice(0, 500) || null, source: fromProposal.length ? "DELIVERABLE" : "MANUAL", sortOrder: existing.size + i })),
    });
    await logActivity({ workspaceId, prospectId, userId: userId ?? undefined, type: "work.month_planned", message: `${fresh.length} tasks planned for ${monthLabel(month)}` });
  }
  return { added: fresh.length, fromProposal: fromProposal.length > 0, client: client.businessName };
}

export async function addTask(workspaceId: string, prospectId: string, month: string, title: string, detail?: string) {
  await ownedClient(workspaceId, prospectId);
  const t = title.trim();
  if (!t) throw new ClientWorkError("Give the task a title.");
  const count = await db.clientTask.count({ where: { prospectId, month } });
  return db.clientTask.create({ data: { workspaceId, prospectId, month, title: t.slice(0, 200), detail: detail?.trim().slice(0, 500) || null, sortOrder: count } });
}

export async function moveTask(workspaceId: string, taskId: string, status: TaskStatus) {
  const { count } = await db.clientTask.updateMany({ where: { id: taskId, workspaceId }, data: { status, doneAt: status === "DONE" ? new Date() : null } });
  if (!count) throw new ClientWorkError("Task not found.");
}

export async function deleteTask(workspaceId: string, taskId: string) {
  const { count } = await db.clientTask.deleteMany({ where: { id: taskId, workspaceId } });
  if (!count) throw new ClientWorkError("Task not found.");
}

/** Done and open work for one client and month — the basis of the monthly work report. */
export async function workReport(workspaceId: string, prospectId: string, month: string) {
  const client = await db.prospect.findFirst({ where: { id: prospectId, workspaceId }, select: { id: true, businessName: true, websiteUrl: true } });
  if (!client) return null;
  const tasks = await db.clientTask.findMany({ where: { workspaceId, prospectId, month }, orderBy: [{ doneAt: "asc" }, { sortOrder: "asc" }] });
  return { client, month, done: tasks.filter((t) => t.status === "DONE"), open: tasks.filter((t) => t.status !== "DONE") };
}
