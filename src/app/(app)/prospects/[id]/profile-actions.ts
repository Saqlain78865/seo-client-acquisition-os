"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { checkProspectProfile } from "@/lib/site-profile";

export async function checkProfileAction(prospectId: string): Promise<{ ok: true; techError: string | null } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    const r = await checkProspectProfile(session.workspace.id, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true, techError: r.techError };
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("site-profile", e)) };
  }
}
