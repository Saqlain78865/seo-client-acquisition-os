"use server";

import { EmailError } from "@/lib/messaging/email";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { CURRENCIES } from "@/lib/constants";
import { deleteFile, putFile } from "@/lib/storage";
import { THEME_KEYS } from "@/lib/proposals/theme";

export type SettingsState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const profileSchema = z.object({
  companyName: text(120),
  consultantName: text(120),
  companyEmail: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  companyPhone: text(40),
  companyWebsite: z
    .string()
    .trim()
    .url("Include https://")
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  consultantWhatsApp: text(40),
  defaultCurrency: z.enum(CURRENCIES),
  proposalTheme: z.enum(THEME_KEYS),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #e11d48")
    .optional()
    .or(z.literal(""))
    .transform((v) => v?.toLowerCase() || null),
  weeklyDigest: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  crawlPageLimit: z.coerce.number().int().min(5, "At least 5").max(200, "At most 200"),
  crawlDelayMs: z.coerce.number().int().min(250, "At least 250 ms").max(10000),
});

async function errorState(e: unknown): Promise<SettingsState> {
  if (e instanceof ForbiddenError) return { error: "Only owners and admins can change settings." };
  return { error: withReference("Could not save settings.", await reportError("settings", e)) };
}

export async function saveProfileAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const session = await requireRole("ADMIN");
    const parsed = profileSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    if (parsed.data.proposalTheme === "brand" && !parsed.data.brandColor) return { fieldErrors: { brandColor: ["Pick your brand colour to use this theme."] } };
    await db.workspaceSettings.upsert({ where: { workspaceId: session.workspace.id }, create: { workspaceId: session.workspace.id, ...parsed.data }, update: parsed.data });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return errorState(e);
  }
}

const LOGO_TYPES = [
  { ext: "png", test: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", test: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", test: (b: Buffer) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];

/** Accepts PNG, JPEG or WebP up to 1 MB, checked by file signature (not by name). SVG is refused. */
export async function uploadLogoAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const session = await requireRole("ADMIN");
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) return { fieldErrors: { logo: ["Choose an image file."] } };
    if (file.size > 1024 * 1024) return { fieldErrors: { logo: ["The logo must be 1 MB or smaller."] } };
    const buf = Buffer.from(await file.arrayBuffer());
    const type = LOGO_TYPES.find((t) => t.test(buf));
    if (!type) return { fieldErrors: { logo: ["Use a PNG, JPG or WebP image."] } };
    const key = `logos/${session.workspace.id}/logo-${createHash("sha256").update(buf).digest("hex").slice(0, 16)}.${type.ext}`;
    await putFile(key, buf);
    const prev = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id } });
    await db.workspaceSettings.upsert({ where: { workspaceId: session.workspace.id }, create: { workspaceId: session.workspace.id, logoPath: key }, update: { logoPath: key } });
    if (prev?.logoPath && prev.logoPath !== key) await deleteFile(prev.logoPath);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function removeLogoAction() {
  const session = await requireRole("ADMIN");
  const s = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id } });
  if (s?.logoPath) {
    await deleteFile(s.logoPath);
    await db.workspaceSettings.update({ where: { workspaceId: session.workspace.id }, data: { logoPath: null } });
  }
  revalidatePath("/settings");
}

// ───────────── Pipeline statuses ─────────────

export async function addStatusAction(_: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const session = await requireRole("ADMIN");
    const label = String(formData.get("label") ?? "").trim();
    if (label.length < 2 || label.length > 40) return { fieldErrors: { label: ["Use 2–40 characters."] } };
    const key = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "STATUS";
    const exists = await db.pipelineStatus.findUnique({ where: { workspaceId_key: { workspaceId: session.workspace.id, key } } });
    if (exists) return { fieldErrors: { label: ["A status with this name already exists."] } };
    const last = await db.pipelineStatus.findFirst({ where: { workspaceId: session.workspace.id }, orderBy: { sortOrder: "desc" } });
    await db.pipelineStatus.create({ data: { workspaceId: session.workspace.id, key, label, sortOrder: (last?.sortOrder ?? 0) + 1, isTerminal: formData.get("isTerminal") === "on" } });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function renameStatusAction(id: string, formData: FormData) {
  const session = await requireRole("ADMIN");
  const label = String(formData.get("label") ?? "").trim().slice(0, 40);
  if (label.length < 2) return;
  await db.pipelineStatus.updateMany({ where: { id, workspaceId: session.workspace.id }, data: { label } });
  revalidatePath("/settings");
}

export async function moveStatusAction(id: string, dir: -1 | 1) {
  const session = await requireRole("ADMIN");
  const all = await db.pipelineStatus.findMany({ where: { workspaceId: session.workspace.id }, orderBy: { sortOrder: "asc" } });
  const i = all.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.$transaction(all.map((s, idx) => db.pipelineStatus.update({ where: { id: s.id }, data: { sortOrder: idx } })));
  revalidatePath("/settings");
}

/** Built-in statuses drive automation (audits, proposals, deals) and cannot be deleted; custom ones can when unused. */
export async function deleteStatusAction(id: string): Promise<SettingsState> {
  try {
    const session = await requireRole("ADMIN");
    const s = await db.pipelineStatus.findFirst({ where: { id, workspaceId: session.workspace.id } });
    if (!s) return { error: "Status not found." };
    if (s.isSystem) return { error: "Built-in statuses cannot be deleted (you can rename them)." };
    const inUse = await db.prospect.count({ where: { workspaceId: session.workspace.id, status: s.key } });
    if (inUse) return { error: `${inUse} prospect${inUse === 1 ? " uses" : "s use"} this status. Move them first.` };
    await db.pipelineStatus.delete({ where: { id } });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function sendDigestNowAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const session = await requireRole("ADMIN");
    const { sendDigest } = await import("@/lib/digest");
    const r = await sendDigest(session.workspace.id);
    return { ok: true, message: `Summary sent to ${r.to.join(", ")}` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Only owners and admins can do this." };
    if (e instanceof EmailError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Could not send the summary.", await reportError("digest", e)) };
  }
}
