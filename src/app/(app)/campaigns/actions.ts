"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { CampaignError, createCampaign, setCampaignStatus } from "@/lib/campaigns";

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function fail(e: unknown): Promise<Result> {
  if (e instanceof CampaignError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong.", await reportError("campaigns", e)) };
}

export async function startCampaignAction(batchId: string, proposalIds: string[], dailyLimit: number): Promise<Result> {
  const session = await requireSession();
  try {
    const c = await createCampaign(session.workspace.id, session.user.id, { batchId, proposalIds: proposalIds.slice(0, 500), dailyLimit });
    revalidatePath("/campaigns");
    revalidatePath(`/audits/bulk/${batchId}`);
    return { ok: true, message: `Auto-send started: ${c._count.recipients} proposals, up to ${c.dailyLimit} a day` };
  } catch (e) {
    return fail(e);
  }
}

export async function setCampaignStatusAction(campaignId: string, status: "ACTIVE" | "PAUSED" | "STOPPED"): Promise<Result> {
  const session = await requireSession();
  try {
    await setCampaignStatus(session.workspace.id, campaignId, status);
    revalidatePath("/campaigns");
    return { ok: true, message: status === "ACTIVE" ? "Resumed" : status === "PAUSED" ? "Paused" : "Stopped" };
  } catch (e) {
    return fail(e);
  }
}
