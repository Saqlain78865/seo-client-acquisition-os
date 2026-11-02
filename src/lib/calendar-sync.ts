import "server-only";
import { db } from "./db";
import { logger } from "./log";
import { appUrl } from "./messaging/share";
import { GoogleApiError, googleJson, googleToken } from "./google-api";

/**
 * Follow-ups in Google Calendar: every pending follow-up becomes an event on the connected
 * calendar with a reminder; rescheduled ones move, and done or cancelled ones are removed.
 * Kept in step every 15 minutes, and straight away from the follow-ups page.
 */

const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const log = logger("calendar-sync");
const TYPE_LABELS: Record<string, string> = { PROPOSAL_REMINDER: "Proposal follow-up", CUSTOM: "Follow-up", MEETING_REMINDER: "Meeting", REVIEW_UNANSWERED: "Answer a review" };

export function eventFor(f: { type: string; dueAt: Date; note: string | null; prospect: { id: string; businessName: string; domain: string } }, base = appUrl()) {
  const end = new Date(f.dueAt.getTime() + 30 * 60_000);
  return {
    summary: `${TYPE_LABELS[f.type] ?? "Follow-up"}: ${f.prospect.businessName}`,
    description: [f.note, f.prospect.domain, `Open in LeadLift: ${base}/prospects/${f.prospect.id}`].filter(Boolean).join("\n\n"),
    start: { dateTime: f.dueAt.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    source: { title: "LeadLift", url: `${base}/prospects/${f.prospect.id}` },
  };
}

/** Creates, moves or removes Calendar events so they match the follow-ups. Returns what changed. */
export async function syncCalendar(workspaceId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const tok = await googleToken(workspaceId, "GOOGLE_CALENDAR", fetchImpl);
  if (!tok) return null;
  const out = { created: 0, updated: 0, removed: 0 };
  // New pending follow-ups (not long past) get an event.
  const fresh = await db.followUp.findMany({ where: { workspaceId, status: "PENDING", calendarEventId: null, dueAt: { gte: new Date(now.getTime() - 86400_000) } }, include: { prospect: { select: { id: true, businessName: true, domain: true } } }, take: 25 });
  for (const f of fresh) {
    const ev = await googleJson<{ id: string }>(tok, EVENTS, { body: eventFor(f) }, fetchImpl);
    await db.followUp.update({ where: { id: f.id }, data: { calendarEventId: ev.id } });
    out.created++;
  }
  // Recently changed pending follow-ups: the event follows the new date or note.
  const changed = await db.followUp.findMany({ where: { workspaceId, status: "PENDING", calendarEventId: { not: null }, updatedAt: { gte: new Date(now.getTime() - 20 * 60_000) } }, include: { prospect: { select: { id: true, businessName: true, domain: true } } }, take: 25 });
  for (const f of changed) {
    if (fresh.some((x) => x.id === f.id)) continue;
    await googleJson(tok, `${EVENTS}/${encodeURIComponent(f.calendarEventId!)}`, { method: "PATCH", body: eventFor(f) }, fetchImpl).catch((e) => log.warn("event update failed", { followUpId: f.id, reason: (e as Error).message }));
    out.updated++;
  }
  // Finished follow-ups leave the calendar.
  const finished = await db.followUp.findMany({ where: { workspaceId, status: { not: "PENDING" }, calendarEventId: { not: null } }, select: { id: true, calendarEventId: true }, take: 25 });
  for (const f of finished) {
    await googleJson(tok, `${EVENTS}/${encodeURIComponent(f.calendarEventId!)}`, { method: "DELETE" }, fetchImpl).catch((e) => {
      // Already deleted in Calendar: nothing to do.
      if (!(e instanceof GoogleApiError && /not found|deleted/i.test(e.message))) throw e;
    });
    await db.followUp.update({ where: { id: f.id }, data: { calendarEventId: null } });
    out.removed++;
  }
  return out;
}

export async function runCalendarSync() {
  const ws = await db.integrationConnection.findMany({ where: { provider: "GOOGLE_CALENDAR", status: "CONNECTED", encryptedSecret: { not: null } }, select: { workspaceId: true } });
  for (const w of ws) await syncCalendar(w.workspaceId).catch((e) => log.warn("calendar sync failed", { workspaceId: w.workspaceId, reason: (e as Error).message }));
}
