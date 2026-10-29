"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ReputationError, startReputationCase } from "@/lib/reputation";

export async function startReputationAction(input: { businessName: string; websiteUrl: string; gbpLink: string }): Promise<{ ok: true; prospectId: string; note: string | null } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    const r = await startReputationCase(session.workspace.id, session.user.id, input);
    revalidatePath("/reputation");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ReputationError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("reputation", e)) };
  }
}
