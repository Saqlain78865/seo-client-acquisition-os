"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { renderTemplate } from "@/lib/messaging/templates";

export type TemplateState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

const schema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  name: z.string().trim().min(2, "Name is required").max(80),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(5, "Write the message").max(5000),
});

function check(data: z.infer<typeof schema>): TemplateState | null {
  if (data.channel === "EMAIL" && !data.subject) return { fieldErrors: { subject: ["Email templates need a subject"] } };
  const unknown = [...renderTemplate(`${data.subject ?? ""} ${data.body}`, {}).unknown];
  if (unknown.length) return { fieldErrors: { body: [`Unknown placeholder: ${unknown.map((u) => `{{${u}}}`).join(", ")}`] } };
  if (data.channel === "WHATSAPP" && data.body.length > 1000) return { fieldErrors: { body: ["Keep WhatsApp messages under 1,000 characters"] } };
  return null;
}

export async function saveTemplateAction(id: string | null, _: TemplateState, formData: FormData): Promise<TemplateState> {
  const session = await requireSession();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const problem = check(parsed.data);
  if (problem) return problem;
  const data = { ...parsed.data, subject: parsed.data.channel === "EMAIL" ? parsed.data.subject : null };
  if (id) {
    const { count } = await db.messageTemplate.updateMany({ where: { id, workspaceId: session.workspace.id }, data: { ...data, version: { increment: 1 } } });
    if (!count) return { error: "Template not found." };
  } else {
    await db.messageTemplate.create({ data: { ...data, workspaceId: session.workspace.id } });
  }
  revalidatePath("/templates");
  return { ok: true };
}

export async function setDefaultTemplateAction(id: string) {
  const session = await requireSession();
  const t = await db.messageTemplate.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!t) return;
  await db.$transaction([
    db.messageTemplate.updateMany({ where: { workspaceId: session.workspace.id, channel: t.channel }, data: { isDefault: false } }),
    db.messageTemplate.update({ where: { id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/templates");
}

export async function deleteTemplateAction(id: string) {
  const session = await requireSession();
  const t = await db.messageTemplate.findFirst({ where: { id, workspaceId: session.workspace.id } });
  if (!t) return { error: "Template not found." };
  const remaining = await db.messageTemplate.count({ where: { workspaceId: session.workspace.id, channel: t.channel } });
  if (remaining <= 1) return { error: "Keep at least one template for each channel." };
  await db.messageTemplate.delete({ where: { id } });
  if (t.isDefault) {
    const next = await db.messageTemplate.findFirst({ where: { workspaceId: session.workspace.id, channel: t.channel } });
    if (next) await db.messageTemplate.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  revalidatePath("/templates");
  return { ok: true };
}
