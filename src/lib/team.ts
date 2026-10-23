import "server-only";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./auth";
import { logActivity } from "./activity";
import { ROLES, type Role } from "./constants";

/** A rule the user broke (wrong password, last owner…); the message is safe to show. */
export class TeamError extends Error {}

/** Changes the password after checking the current one, then signs out every other device. */
export async function changePassword(userId: string, currentSessionId: string, current: string, next: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new TeamError("Your current password is not correct.");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  const { count } = await db.session.deleteMany({ where: { userId, id: { not: currentSessionId } } });
  return { otherSessionsEnded: count };
}

export async function signOutOtherSessions(userId: string, currentSessionId: string) {
  const { count } = await db.session.deleteMany({ where: { userId, id: { not: currentSessionId } } });
  return count;
}

export async function listSessions(userId: string) {
  return db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, ip: true, workspace: { select: { name: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function listMembers(workspaceId: string) {
  return db.workspaceMembership.findMany({
    where: { workspaceId },
    select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Adds a person to the workspace. A new account gets the temporary password the owner chose (to
 * be shared privately and changed on first sign-in); an existing account just gains access and
 * keeps its own password.
 */
export async function addMember(workspaceId: string, actorId: string, input: { name: string; email: string; role: Role; tempPassword: string }) {
  const existing = await db.user.findUnique({ where: { email: input.email }, include: { memberships: { where: { workspaceId } } } });
  if (existing?.memberships.length) throw new TeamError("This person is already a member of the workspace.");
  const user =
    existing ?? (await db.user.create({ data: { name: input.name, email: input.email, passwordHash: await hashPassword(input.tempPassword) } }));
  await db.workspaceMembership.create({ data: { userId: user.id, workspaceId, role: input.role } });
  await logActivity({ workspaceId, userId: actorId, type: "team.member_added", message: `${input.email} added as ${input.role.toLowerCase()}` });
  return { createdAccount: !existing };
}

async function ownerCount(workspaceId: string) {
  return db.workspaceMembership.count({ where: { workspaceId, role: "OWNER" } });
}

async function membershipFor(workspaceId: string, membershipId: string) {
  const m = await db.workspaceMembership.findFirst({ where: { id: membershipId, workspaceId }, include: { user: { select: { email: true } } } });
  if (!m) throw new TeamError("Member not found.");
  return m;
}

export async function changeMemberRole(workspaceId: string, actorId: string, membershipId: string, role: Role) {
  if (!ROLES.includes(role)) throw new TeamError("Unknown role.");
  const m = await membershipFor(workspaceId, membershipId);
  if (m.userId === actorId) throw new TeamError("You cannot change your own role.");
  if (m.role === "OWNER" && role !== "OWNER" && (await ownerCount(workspaceId)) <= 1) throw new TeamError("The workspace needs at least one owner.");
  await db.workspaceMembership.update({ where: { id: m.id }, data: { role } });
  await logActivity({ workspaceId, userId: actorId, type: "team.role_changed", message: `${m.user.email} is now ${role.toLowerCase()}` });
}

/** Removes access and ends that person's sessions in this workspace. Their account itself is kept. */
export async function removeMember(workspaceId: string, actorId: string, membershipId: string) {
  const m = await membershipFor(workspaceId, membershipId);
  if (m.userId === actorId) throw new TeamError("You cannot remove yourself.");
  if (m.role === "OWNER" && (await ownerCount(workspaceId)) <= 1) throw new TeamError("The workspace needs at least one owner.");
  await db.$transaction([
    db.workspaceMembership.delete({ where: { id: m.id } }),
    db.session.deleteMany({ where: { userId: m.userId, workspaceId } }),
  ]);
  await logActivity({ workspaceId, userId: actorId, type: "team.member_removed", message: `${m.user.email} removed from the workspace` });
}
