import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { SESSION_COOKIE, SESSION_TTL_DAYS, type Role } from "./constants";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_PER_EMAIL = 5;
const MAX_FAILED_PER_IP = 20;

export type SessionContext = {
  sessionId: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; isDemo: boolean };
  role: Role;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Returns true when the email or IP has too many recent failed logins. */
export async function isLoginRateLimited(email: string) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } }),
    ip ? db.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }) : 0,
  ]);
  return byEmail >= MAX_FAILED_PER_EMAIL || byIp >= MAX_FAILED_PER_IP;
}

export async function recordLoginAttempt(email: string, success: boolean, userId?: string) {
  await db.loginAttempt.create({ data: { email, success, userId, ip: await clientIp() } });
}

export async function createSession(userId: string, workspaceId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  const h = await headers();
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      workspaceId,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 300),
      ip: await clientIp(),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Resolves the current session once per request. Returns null when signed out or expired. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true, workspace: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const membership = await db.workspaceMembership.findUnique({
    where: { userId_workspaceId: { userId: session.userId, workspaceId: session.workspaceId } },
  });
  if (!membership) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    sessionId: session.id,
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    workspace: { id: session.workspace.id, name: session.workspace.name, isDemo: session.workspace.isDemo },
    role: membership.role as Role,
  };
});

/** For pages and server actions: redirects to /login when there is no valid session. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

const ROLE_RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasRole(session: SessionContext, minimum: Role) {
  return ROLE_RANK[session.role] >= ROLE_RANK[minimum];
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
  }
}

export async function requireRole(minimum: Role): Promise<SessionContext> {
  const session = await requireSession();
  if (!hasRole(session, minimum)) throw new ForbiddenError();
  return session;
}
