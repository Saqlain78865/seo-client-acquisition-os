"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireRole, requireSession } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/constants";
import { reportError, withReference } from "@/lib/log";
import { TeamError, addMember, changeMemberRole, changePassword, removeMember, signOutOtherSessions } from "@/lib/team";
import { addMemberSchema, changePasswordSchema } from "@/lib/validation";

export type AccountState = { ok?: boolean; message?: string; error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  if (e instanceof TeamError || e instanceof ForbiddenError) return { ok: false, error: e.message };
  return { ok: false, error: withReference("Something went wrong. Please try again.", await reportError("account", e)) };
}

export async function changePasswordAction(_: AccountState, formData: FormData): Promise<AccountState> {
  const session = await requireSession();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const { otherSessionsEnded } = await changePassword(session.user.id, session.sessionId, parsed.data.currentPassword, parsed.data.newPassword);
    revalidatePath("/account");
    return { ok: true, message: otherSessionsEnded ? `Password changed. Signed out ${otherSessionsEnded} other device${otherSessionsEnded === 1 ? "" : "s"}.` : "Password changed." };
  } catch (e) {
    if (e instanceof TeamError) return { fieldErrors: { currentPassword: [e.message] } };
    return fail(e);
  }
}

export async function signOutOthersAction() {
  const session = await requireSession();
  const count = await signOutOtherSessions(session.user.id, session.sessionId);
  revalidatePath("/account");
  return { ok: true as const, count };
}

export async function addMemberAction(_: AccountState, formData: FormData): Promise<AccountState> {
  try {
    const session = await requireRole("OWNER");
    const parsed = addMemberSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    const { createdAccount } = await addMember(session.workspace.id, session.user.id, parsed.data);
    revalidatePath("/account");
    return {
      ok: true,
      message: createdAccount
        ? `${parsed.data.email} added. Share the temporary password privately and ask them to change it after signing in.`
        : `${parsed.data.email} already had an account and can now open this workspace with their own password.`,
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "Only owners can manage the team." };
    return fail(e);
  }
}

export async function changeRoleAction(membershipId: string, role: string) {
  try {
    const session = await requireRole("OWNER");
    if (!ROLES.includes(role as Role)) return { ok: false as const, error: "Unknown role." };
    await changeMemberRole(session.workspace.id, session.user.id, membershipId, role as Role);
    revalidatePath("/account");
    return { ok: true as const };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(membershipId: string) {
  try {
    const session = await requireRole("OWNER");
    await removeMember(session.workspace.id, session.user.id, membershipId);
    revalidatePath("/account");
    return { ok: true as const };
  } catch (e) {
    return fail(e);
  }
}
