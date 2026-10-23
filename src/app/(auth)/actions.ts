"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  isLoginRateLimited,
  recordLoginAttempt,
  verifyPassword,
} from "@/lib/auth";
import { loginSchema, registerSchema } from "@/lib/validation";
import { createWorkspace } from "@/lib/workspace";

export type AuthFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> } | undefined;

// Compared against when the email is unknown, so both failure paths take the same time.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equalisation-only"));

/** Self-registration is only open for first-run setup; later users are invited by an owner. */
async function registrationOpen() {
  return process.env.ALLOW_REGISTRATION === "true" || (await db.user.count()) === 0;
}

export async function login(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const { email, password } = parsed.data;

  if (await isLoginRateLimited(email)) {
    return { error: "Too many failed attempts. Please wait 15 minutes and try again." };
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok || user.memberships.length === 0) {
    await recordLoginAttempt(email, false, user?.id);
    return { error: "Incorrect email or password." };
  }

  await recordLoginAttempt(email, true, user.id);
  await createSession(user.id, user.memberships[0].workspaceId);
  redirect("/");
}

export async function register(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!(await registrationOpen())) {
    return { error: "Registration is closed. Ask the workspace owner to add you." };
  }
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const { name, email, password, workspaceName } = parsed.data;

  if (await db.user.findUnique({ where: { email } })) {
    return { fieldErrors: { email: ["An account with this email already exists."] } };
  }

  const user = await db.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
  const workspace = await createWorkspace(workspaceName, user.id);
  await createSession(user.id, workspace.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
