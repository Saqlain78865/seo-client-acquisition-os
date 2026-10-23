"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { ClientWorkError, TASK_STATUSES, addTask, deleteTask, isMonthKey, moveTask, planMonth, type TaskStatus } from "@/lib/client-work";

export type WorkResult = { ok: true; message?: string } | { ok: false; error: string };

async function run(fn: () => Promise<string | undefined>): Promise<WorkResult> {
  try {
    const message = await fn();
    revalidatePath("/work");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof ClientWorkError) return { ok: false, error: e.message };
    return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("work", e)) };
  }
}

export async function planMonthAction(prospectId: string, month: string) {
  return run(async () => {
    const session = await requireSession();
    if (!isMonthKey(month)) throw new ClientWorkError("Invalid month.");
    const r = await planMonth(session.workspace.id, session.user.id, prospectId, month);
    if (!r.added) return `${r.client}: this month is already planned`;
    return `${r.added} tasks added for ${r.client}${r.fromProposal ? " from the proposal's monthly deliverables" : ""}`;
  });
}

export async function addTaskAction(prospectId: string, month: string, title: string) {
  return run(async () => {
    const session = await requireSession();
    if (!isMonthKey(month)) throw new ClientWorkError("Invalid month.");
    await addTask(session.workspace.id, prospectId, month, title);
    return "Task added";
  });
}

export async function moveTaskAction(taskId: string, status: TaskStatus) {
  return run(async () => {
    const session = await requireSession();
    if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new ClientWorkError("Invalid status.");
    await moveTask(session.workspace.id, taskId, status);
    return undefined;
  });
}

export async function deleteTaskAction(taskId: string) {
  return run(async () => {
    const session = await requireSession();
    await deleteTask(session.workspace.id, taskId);
    return "Task removed";
  });
}
