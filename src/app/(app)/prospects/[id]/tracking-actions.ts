"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { checkSiteChanges } from "@/lib/site-changes";

/** Crawls the client's live website now and records what changed since the last check. */
export async function checkChangesAction(prospectId: string): Promise<({ ok: true } & { baseline: boolean; changes: number; pages: number }) | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    const r = await checkSiteChanges(session.workspace.id, { prospectId });
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof Error && /respond|Blocked|could not be found|not found/i.test(e.message)) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("tracking", e)) };
  }
}
