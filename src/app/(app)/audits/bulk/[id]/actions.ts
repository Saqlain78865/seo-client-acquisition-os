"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { createBatchProposals, sendBatchProposals } from "@/lib/messaging/bulk-send";
import { SendError } from "@/lib/messaging/service";

export async function createBatchProposalsAction(batchId: string): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    const created = await createBatchProposals(session.workspace.id, session.user.id, batchId);
    revalidatePath(`/audits/bulk/${batchId}`);
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: withReference("Proposals could not be created.", await reportError("bulk-proposals", e)) };
  }
}

export async function sendBatchAction(batchId: string, proposalIds: string[]): Promise<{ ok: true; results: { proposalId: string; ok: boolean; message: string }[] } | { ok: false; error: string }> {
  const session = await requireSession();
  try {
    const results = await sendBatchProposals(session.workspace.id, session.user.id, batchId, proposalIds.slice(0, 50));
    revalidatePath(`/audits/bulk/${batchId}`);
    return { ok: true, results };
  } catch (e) {
    if (e instanceof SendError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Sending stopped.", await reportError("bulk-send", e)) };
  }
}
