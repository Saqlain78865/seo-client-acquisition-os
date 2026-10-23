import "server-only";
import { db } from "./db";

export const ACTIVITY_TYPES = {
  PROSPECT_CREATED: "prospect.created",
  PROSPECT_UPDATED: "prospect.updated",
  PROSPECT_STATUS_CHANGED: "prospect.status_changed",
  PROSPECT_MERGED: "prospect.merged",
  CONTACT_UPDATED: "contact.updated",
  NOTE_ADDED: "note.added",
  FOLLOW_UP_SCHEDULED: "followup.scheduled",
  FOLLOW_UP_UPDATED: "followup.updated",
  AUDIT_STARTED: "audit.started",
  AUDIT_COMPLETED: "audit.completed",
  PROPOSAL_GENERATED: "proposal.generated",
  PROPOSAL_EDITED: "proposal.edited",
  PDF_GENERATED: "proposal.pdf_generated",
  EMAIL_SENT: "delivery.email_sent",
  WHATSAPP_SENT: "delivery.whatsapp_sent",
  DEAL_WON: "deal.won",
  DEAL_LOST: "deal.lost",
} as const;

export async function logActivity(input: {
  workspaceId: string;
  type: string;
  message: string;
  prospectId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.activityLog.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      message: input.message,
      prospectId: input.prospectId ?? null,
      userId: input.userId ?? null,
      metadata: input.metadata as object | undefined,
    },
  });
  if (input.prospectId) {
    await db.prospect.update({ where: { id: input.prospectId }, data: { lastActivityAt: new Date() } });
  }
}
