"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { AuditVideoError, requestAuditVideo } from "@/lib/video/audit-video";

export async function requestVideoAction(prospectId: string, voice: "female" | "male" | "none" = "female"): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    await requestAuditVideo(session.workspace.id, prospectId, voice === "male" || voice === "none" ? voice : "female");
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuditVideoError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("audit-video", e)) };
  }
}
