"use server";

import { ensureKickoff, setKickoffTaskDone } from "@/lib/kickoff";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireRole, requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ACTIVITY_TYPES, logActivity } from "@/lib/activity";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, FOLLOW_UP_TYPES, type ContactType } from "@/lib/constants";
import { followUpSchema, noteSchema, prospectSchema, prospectStatusSchema } from "@/lib/validation";
import { normalizeContactValue, validateContactValue } from "@/lib/contacts";
import {
  addContact,
  createProspect,
  findDuplicateProspects,
  mergeProspects,
  recomputeNextFollowUp,
  updateProspect,
} from "@/lib/prospects";

export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      duplicates?: { id: string; businessName: string; websiteUrl: string }[];
      ok?: boolean;
    }
  | undefined;

async function failure(e: unknown): Promise<FormState> {
  if (e instanceof ForbiddenError) return { error: e.message };
  return { error: withReference("Something went wrong. Please try again.", await reportError("prospects", e)) };
}

async function ownedProspect(workspaceId: string, id: string) {
  const p = await db.prospect.findFirst({ where: { id, workspaceId }, select: { id: true, businessName: true, status: true } });
  if (!p) throw new ForbiddenError("Prospect not found in this workspace.");
  return p;
}

export async function createProspectAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = prospectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  if (formData.get("confirmDuplicate") !== "1") {
    const duplicates = await findDuplicateProspects(session.workspace.id, parsed.data);
    if (duplicates.length) return { duplicates };
  }

  let id: string;
  try {
    const prospect = await createProspect(session.workspace.id, session.user.id, parsed.data);
    id = prospect.id;
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId: id,
      userId: session.user.id,
      type: ACTIVITY_TYPES.PROSPECT_CREATED,
      message: `Prospect ${prospect.businessName} created`,
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/prospects");
  redirect(`/prospects/${id}`);
}

export async function updateProspectAction(id: string, _: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = prospectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const ok = await updateProspect(session.workspace.id, id, parsed.data);
    if (!ok) return { error: "Prospect not found." };
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId: id,
      userId: session.user.id,
      type: ACTIVITY_TYPES.PROSPECT_UPDATED,
      message: "Prospect details updated",
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/prospects/${id}`);
  redirect(`/prospects/${id}`);
}

export async function changeStatusAction(id: string, _: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = prospectStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const { status, lostReason, wonValue } = parsed.data;
  try {
    const prospect = await ownedProspect(session.workspace.id, id);
    const def = await db.pipelineStatus.findUnique({
      where: { workspaceId_key: { workspaceId: session.workspace.id, key: status } },
    });
    if (!def) return { error: "Unknown pipeline status." };
    if ((status === "LOST" || status === "NOT_INTERESTED") && !lostReason) {
      return { fieldErrors: { lostReason: ["Record why the deal was lost."] } };
    }
    if (status === "WON" && wonValue == null) {
      return { fieldErrors: { wonValue: ["Enter the agreed deal value."] } };
    }

    await db.$transaction(async (tx) => {
      await tx.prospect.update({
        where: { id },
        data: {
          status,
          lostReason: status === "LOST" || status === "NOT_INTERESTED" ? lostReason : undefined,
          wonValue: status === "WON" ? wonValue : undefined,
        },
      });
      if (status === "WON" || status === "LOST") {
        const p = await tx.prospect.findUniqueOrThrow({ where: { id } });
        const open = await tx.deal.findFirst({ where: { prospectId: id, stage: "OPEN" } });
        const data = {
          stage: status,
          value: status === "WON" ? wonValue : p.estimatedValue,
          currency: p.currency,
          closedAt: new Date(),
          lostReason: status === "LOST" ? lostReason : null,
        };
        if (open) await tx.deal.update({ where: { id: open.id }, data });
        else
          await tx.deal.create({
            data: { ...data, workspaceId: session.workspace.id, prospectId: id, title: `${p.businessName} — SEO` },
          });
      }
    });

    if (status === "WON") await ensureKickoff(session.workspace.id, id);
    const type =
      status === "WON" ? ACTIVITY_TYPES.DEAL_WON : status === "LOST" ? ACTIVITY_TYPES.DEAL_LOST : ACTIVITY_TYPES.PROSPECT_STATUS_CHANGED;
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId: id,
      userId: session.user.id,
      type,
      message: `Status changed to ${def.label}${lostReason ? ` — ${lostReason}` : ""}`,
      metadata: { from: prospect.status, to: status },
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/prospects/${id}`);
  revalidatePath("/");
  return { ok: true };
}

export async function addNoteAction(prospectId: string, _: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await ownedProspect(session.workspace.id, prospectId);
    await db.meetingNote.create({
      data: { prospectId, authorId: session.user.id, kind: parsed.data.kind, body: parsed.data.body },
    });
    const label = { MEETING: "Meeting note", OBJECTION: "Client objection", GENERAL: "Note" }[parsed.data.kind];
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId,
      userId: session.user.id,
      type: ACTIVITY_TYPES.NOTE_ADDED,
      message: `${label} added`,
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/prospects/${prospectId}`);
  return { ok: true };
}

const contactSchema = z.object({
  type: z.enum(CONTACT_TYPES),
  value: z.string().trim().min(1, "Value is required").max(500),
  label: z.string().trim().max(100).optional(),
  sourceUrl: z.string().trim().url("Enter a valid URL").optional().or(z.literal("").transform(() => undefined)),
});

export async function addContactAction(prospectId: string, _: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (validateContactValue(parsed.data.type, parsed.data.value) === "INVALID_FORMAT") {
    return { fieldErrors: { value: [`This does not look like a valid ${CONTACT_TYPE_LABELS[parsed.data.type].toLowerCase()}.`] } };
  }
  try {
    await ownedProspect(session.workspace.id, prospectId);
    await addContact(prospectId, parsed.data);
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId,
      userId: session.user.id,
      type: ACTIVITY_TYPES.CONTACT_UPDATED,
      message: `${CONTACT_TYPE_LABELS[parsed.data.type as ContactType]} added`,
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/prospects/${prospectId}`);
  return { ok: true };
}

async function ownedContact(workspaceId: string, contactId: string) {
  const c = await db.prospectContact.findFirst({ where: { id: contactId, prospect: { workspaceId } } });
  if (!c) throw new ForbiddenError("Contact not found.");
  return c;
}

export async function updateContactAction(contactId: string, formData: FormData) {
  const session = await requireSession();
  const c = await ownedContact(session.workspace.id, contactId);
  const intent = formData.get("intent");
  if (intent === "verify") {
    await db.prospectContact.update({
      where: { id: c.id },
      data: { verified: !c.verified, verifiedAt: c.verified ? null : new Date() },
    });
  } else if (intent === "prefer") {
    await db.$transaction([
      db.prospectContact.updateMany({ where: { prospectId: c.prospectId, type: c.type }, data: { isPreferred: false } }),
      db.prospectContact.update({ where: { id: c.id }, data: { isPreferred: true } }),
    ]);
  } else if (intent === "edit") {
    const value = String(formData.get("value") ?? "").trim();
    if (!value || validateContactValue(c.type, value) === "INVALID_FORMAT") return;
    await db.prospectContact.update({
      where: { id: c.id },
      data: {
        value: normalizeContactValue(c.type, value),
        validationStatus: validateContactValue(c.type, value),
        sourceMethod: "MANUAL",
        verified: true,
        verifiedAt: new Date(),
      },
    });
  } else if (intent === "delete") {
    await db.prospectContact.delete({ where: { id: c.id } });
  }
  await logActivity({
    workspaceId: session.workspace.id,
    prospectId: c.prospectId,
    userId: session.user.id,
    type: ACTIVITY_TYPES.CONTACT_UPDATED,
    message: `${CONTACT_TYPE_LABELS[c.type as ContactType] ?? c.type} ${intent === "delete" ? "removed" : "updated"}`,
  });
  revalidatePath(`/prospects/${c.prospectId}`);
}

export async function scheduleFollowUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = followUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await ownedProspect(session.workspace.id, parsed.data.prospectId);
    await db.followUp.create({ data: { ...parsed.data, workspaceId: session.workspace.id } });
    await recomputeNextFollowUp(parsed.data.prospectId);
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId: parsed.data.prospectId,
      userId: session.user.id,
      type: ACTIVITY_TYPES.FOLLOW_UP_SCHEDULED,
      message: `${FOLLOW_UP_TYPES[parsed.data.type]} scheduled for ${parsed.data.dueAt.toISOString().slice(0, 10)}`,
    });
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/prospects/${parsed.data.prospectId}`);
  revalidatePath("/follow-ups");
  return { ok: true };
}

const followUpStatusSchema = z.object({
  status: z.enum(["PENDING", "DONE", "PAUSED", "CANCELLED"]),
  result: z.string().trim().max(2000).optional(),
});

export async function updateFollowUpAction(followUpId: string, formData: FormData) {
  const session = await requireSession();
  const parsed = followUpStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const f = await db.followUp.findFirst({ where: { id: followUpId, workspaceId: session.workspace.id } });
  if (!f) throw new ForbiddenError("Follow-up not found.");
  await db.followUp.update({
    where: { id: f.id },
    data: {
      status: parsed.data.status,
      result: parsed.data.result || f.result,
      completedAt: parsed.data.status === "DONE" ? new Date() : null,
    },
  });
  await recomputeNextFollowUp(f.prospectId);
  await logActivity({
    workspaceId: session.workspace.id,
    prospectId: f.prospectId,
    userId: session.user.id,
    type: ACTIVITY_TYPES.FOLLOW_UP_UPDATED,
    message: `Follow-up marked ${parsed.data.status.toLowerCase()}`,
  });
  revalidatePath(`/prospects/${f.prospectId}`);
  revalidatePath("/follow-ups");
  revalidatePath("/");
}

export async function mergeProspectsAction(targetId: string, _: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireRole("ADMIN");
    const sourceId = String(formData.get("sourceId") ?? "");
    if (formData.get("confirm") !== "MERGE") return { error: 'Type MERGE to confirm.' };
    const { sourceName } = await mergeProspects(session.workspace.id, targetId, sourceId);
    await logActivity({
      workspaceId: session.workspace.id,
      prospectId: targetId,
      userId: session.user.id,
      type: ACTIVITY_TYPES.PROSPECT_MERGED,
      message: `Merged duplicate prospect "${sourceName}" into this record`,
    });
  } catch (e) {
    if (e instanceof Error && !(e instanceof ForbiddenError) && e.message.includes("merge")) return { error: e.message };
    return failure(e);
  }
  revalidatePath("/prospects");
  redirect(`/prospects/${targetId}`);
}

export async function deleteProspectAction(id: string, _: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireRole("ADMIN");
    const p = await ownedProspect(session.workspace.id, id);
    if (String(formData.get("confirm") ?? "").trim() !== p.businessName) {
      return { error: "Type the business name exactly to confirm deletion." };
    }
    await db.prospect.delete({ where: { id } });
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/prospects");
  redirect("/prospects");
}

/** Opt-out: while set, no email or WhatsApp can be sent to this prospect from the app. */
export async function setDoNotContactAction(prospectId: string, formData: FormData) {
  const session = await requireSession();
  const p = await ownedProspect(session.workspace.id, prospectId);
  const on = formData.get("on") === "1";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300) || null;
  await db.prospect.update({ where: { id: p.id }, data: { doNotContact: on, doNotContactReason: on ? reason : null } });
  await logActivity({ workspaceId: session.workspace.id, prospectId, userId: session.user.id, type: "prospect.opt_out", message: on ? `Marked as do not contact${reason ? ` (${reason})` : ""}` : "Do-not-contact removed" });
  revalidatePath(`/prospects/${prospectId}`);
}

export async function toggleKickoffTaskAction(prospectId: string, taskId: string, done: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const task = await setKickoffTaskDone(session.workspace.id, taskId, done);
  if (!task || task.prospectId !== prospectId) return { ok: false, error: "Task not found." };
  revalidatePath(`/prospects/${prospectId}`);
  return { ok: true };
}
