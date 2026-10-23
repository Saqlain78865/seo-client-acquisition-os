"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireRole } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { SystemError, dismissJob, retryJob, runMaintenance, type MaintenanceResult } from "@/lib/system";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof SystemError || e instanceof ForbiddenError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("system", e)) };
}

export async function retryJobAction(jobId: string): Promise<Result> {
  try {
    const session = await requireRole("ADMIN");
    await retryJob(session.workspace.id, session.user.id, jobId);
    revalidatePath("/system");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissJobAction(jobId: string): Promise<Result> {
  try {
    const session = await requireRole("ADMIN");
    await dismissJob(session.workspace.id, session.user.id, jobId);
    revalidatePath("/system");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function runMaintenanceAction(): Promise<Result<{ result: MaintenanceResult }>> {
  try {
    await requireRole("OWNER");
    const result = await runMaintenance();
    revalidatePath("/system");
    return { ok: true, result };
  } catch (e) {
    return fail(e);
  }
}
