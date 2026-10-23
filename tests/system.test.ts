import { beforeAll, describe, expect, it, vi } from "vitest";

// Retrying an audit queues a real job; the runner itself is covered elsewhere, so it is a no-op here.
vi.mock("@/lib/audit/runner", () => ({ runAudit: vi.fn(async () => undefined), runnerOptions: { allowPrivateNetworks: false } }));

import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createProspect } from "@/lib/prospects";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { saveCredentials } from "@/lib/integrations";
import { fileExists, putFile } from "@/lib/storage";
import { logger, maskSecrets } from "@/lib/log";
import { SystemError, dismissJob, exportWorkspace, retryJob, runMaintenance } from "@/lib/system";
import { TeamError, addMember, changeMemberRole, changePassword, removeMember } from "@/lib/team";

describe("structured logging", () => {
  it("masks secret-looking keys and values, and serialises errors", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((l: string) => void lines.push(l));
    logger("test").error("failed with key=abc123secret", {
      smtp: { user: "me@x.com", pass: "hunter2" },
      apiKey: "AIzaSyD-not-a-real-key-000000000000000",
      err: new Error("401 for https://x.test/api?key=AIzaSyD0000000000000000000000000000000"),
      authorization: "Bearer abc.def.ghi",
    });
    spy.mockRestore();
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ level: "error", scope: "test", smtp: { user: "me@x.com", pass: "[redacted]" }, apiKey: "[redacted]", authorization: "[redacted]" });
    expect(entry.err.message).toBe("401 for https://x.test/api?key=[redacted]");
    expect(lines[0]).not.toMatch(/hunter2|AIzaSyD0|abc\.def/);
    expect(maskSecrets("token ya29.a0AfH6SMB and AIzaSyFAKEtestKEY0000000000000000000000")).toBe("token ya29.[redacted] and AIza[redacted]");
  });
});

describe("system: jobs, retention and export", () => {
  let workspaceId: string;
  let otherWorkspaceId: string;
  let userId: string;
  let auditId: string;

  beforeAll(async () => {
    const user = await db.user.create({ data: { email: `sys${Date.now()}@test.example`, name: "Sys", passwordHash: "x" } });
    userId = user.id;
    workspaceId = (await createWorkspace("System WS", user.id)).id;
    otherWorkspaceId = (await createWorkspace("Other WS", user.id)).id;
    const prospect = await createProspect(workspaceId, userId, { businessName: "Retry Co", websiteUrl: "https://retry.example", currency: "USD" });
    const audit = await db.websiteAudit.create({
      data: { workspaceId, prospectId: prospect.id, inputUrl: "retry.example", normalizedUrl: "https://retry.example/", status: "FAILED" },
    });
    auditId = audit.id;
  });

  it("retries a failed audit job once, and refuses other workspaces and non-failed jobs", async () => {
    const job = await db.backgroundJob.create({ data: { workspaceId, type: "audit.run", payload: { auditId }, status: "FAILED", attempts: 1, lastError: "boom", correlationId: "corr-1" } });
    await expect(retryJob(otherWorkspaceId, userId, job.id)).rejects.toThrow(SystemError);

    await retryJob(workspaceId, userId, job.id);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("RETRIED");
    const fresh = await db.backgroundJob.findMany({ where: { workspaceId, type: "audit.run", id: { not: job.id } } });
    expect(fresh).toHaveLength(1);
    expect(fresh[0].payload).toEqual({ auditId });
    // A second click finds the job already handled.
    await expect(retryJob(workspaceId, userId, job.id)).rejects.toThrow("Only failed jobs can be retried.");
    expect(await db.activityLog.count({ where: { workspaceId, type: "system.job_retried" } })).toBe(1);
  });

  it("re-queues other job types in place and lets admins dismiss", async () => {
    const job = await db.backgroundJob.create({ data: { workspaceId, type: "unknown.kind", payload: {}, status: "FAILED", attempts: 3, maxAttempts: 3 } });
    await retryJob(workspaceId, userId, job.id);
    const after = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    // The worker may already have picked it up (and failed it: no handler); either way it ran again.
    expect(after.maxAttempts).toBe(4);

    const other = await db.backgroundJob.create({ data: { workspaceId, type: "x", payload: {}, status: "FAILED" } });
    await dismissJob(workspaceId, userId, other.id);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("DISMISSED");
    await expect(dismissJob(workspaceId, userId, other.id)).rejects.toThrow(SystemError);
  });

  it("clean-up removes expired and old records and orphaned files, and keeps everything else", async () => {
    const now = Date.now();
    const old = new Date(now - 40 * 86_400_000);
    const expired = await db.session.create({ data: { tokenHash: `exp-${now}`, userId, workspaceId, expiresAt: new Date(now - 1000) } });
    const live = await db.session.create({ data: { tokenHash: `live-${now}`, userId, workspaceId, expiresAt: new Date(now + 86_400_000) } });
    const oldAttempt = await db.loginAttempt.create({ data: { email: "a@b.c", success: false, createdAt: old } });
    const newAttempt = await db.loginAttempt.create({ data: { email: "a@b.c", success: false } });
    const oldJob = await db.backgroundJob.create({ data: { workspaceId, type: "x", payload: {}, status: "COMPLETED" } });
    await db.$executeRawUnsafe(`UPDATE BackgroundJob SET updatedAt = ? WHERE id = ?`, old.getTime(), oldJob.id);
    const failedOld = await db.backgroundJob.create({ data: { workspaceId, type: "x", payload: {}, status: "FAILED" } });
    await db.$executeRawUnsafe(`UPDATE BackgroundJob SET updatedAt = ? WHERE id = ?`, old.getTime(), failedOld.id);

    const orphan = `proposals/${workspaceId}/deleted/v1-aaaa.pdf`;
    const unknownWorkspace = `proposals/not-in-this-db/x/v1.pdf`;
    await putFile(orphan, Buffer.from("%PDF"));
    await putFile(unknownWorkspace, Buffer.from("%PDF"));

    // Pretend the clean-up runs two hours later, so the new orphan file is past the one-hour grace period.
    const r = await runMaintenance(now + 2 * 3_600_000);
    expect(r.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(r.orphanFiles).toBe(1);
    expect(await db.session.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await db.loginAttempt.findUnique({ where: { id: oldAttempt.id } })).toBeNull();
    expect(await db.loginAttempt.findUnique({ where: { id: newAttempt.id } })).not.toBeNull();
    expect(await db.backgroundJob.findUnique({ where: { id: oldJob.id } })).toBeNull();
    // Failed jobs stay until someone retries or dismisses them.
    expect(await db.backgroundJob.findUnique({ where: { id: failedOld.id } })).not.toBeNull();
    expect(await fileExists(orphan)).toBe(false);
    expect(await fileExists(unknownWorkspace)).toBe(true);

    // A file that is still referenced is never removed.
    const kept = `logos/${workspaceId}/logo-1.png`;
    await putFile(kept, Buffer.from("png"));
    await db.workspaceSettings.update({ where: { workspaceId }, data: { logoPath: kept } });
    await runMaintenance(now + 2 * 3_600_000);
    expect(await fileExists(kept)).toBe(true);
  });

  it("exports workspace data without any secret", async () => {
    await saveCredentials(workspaceId, "PAGESPEED", { secret: { apiKey: "super-secret-key-123" }, accountLabel: "Key", config: {} });
    await db.session.create({ data: { tokenHash: "secret-session-hash", userId, workspaceId, expiresAt: new Date(Date.now() + 86_400_000) } });
    const data = await exportWorkspace(workspaceId);
    const json = JSON.stringify(data);
    expect(data.prospects.some((p) => p.businessName === "Retry Co")).toBe(true);
    expect(data.integrations).toEqual([expect.objectContaining({ provider: "PAGESPEED" })]);
    for (const forbidden of ["passwordHash", "tokenHash", "encryptedSecret", "shareToken", "storageKey", "super-secret-key-123", "secret-session-hash"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("account and team", () => {
  let workspaceId: string;
  let ownerId: string;
  let ownerSession: string;

  beforeAll(async () => {
    const owner = await db.user.create({ data: { email: `owner${Date.now()}@test.example`, name: "Owner", passwordHash: await hashPassword("OldPassword123") } });
    ownerId = owner.id;
    workspaceId = (await createWorkspace("Team WS", owner.id)).id;
    const exp = new Date(Date.now() + 86_400_000);
    ownerSession = (await db.session.create({ data: { tokenHash: `own-a-${Date.now()}`, userId: ownerId, workspaceId, expiresAt: exp } })).id;
    await db.session.create({ data: { tokenHash: `own-b-${Date.now()}`, userId: ownerId, workspaceId, expiresAt: exp } });
  });

  it("changes the password only with the current one, and signs out other devices", async () => {
    await expect(changePassword(ownerId, ownerSession, "wrong", "NewPassword456")).rejects.toThrow(TeamError);
    const r = await changePassword(ownerId, ownerSession, "OldPassword123", "NewPassword456");
    expect(r.otherSessionsEnded).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(await verifyPassword("NewPassword456", user.passwordHash)).toBe(true);
    expect(await db.session.findMany({ where: { userId: ownerId } })).toEqual([expect.objectContaining({ id: ownerSession })]);
  });

  it("adds members, protects the last owner and removes access", async () => {
    const email = `member${Date.now()}@test.example`;
    expect(await addMember(workspaceId, ownerId, { name: "Mem", email, role: "MEMBER", tempPassword: "TempPassword1" })).toEqual({ createdAccount: true });
    await expect(addMember(workspaceId, ownerId, { name: "Mem", email, role: "MEMBER", tempPassword: "TempPassword1" })).rejects.toThrow("already a member");
    const member = await db.workspaceMembership.findFirstOrThrow({ where: { workspaceId, user: { email } } });
    const memberUser = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await verifyPassword("TempPassword1", memberUser.passwordHash)).toBe(true);

    // An existing account keeps its own password when added to another workspace.
    const ws2 = (await createWorkspace("Second", ownerId)).id;
    expect(await addMember(ws2, ownerId, { name: "Mem", email, role: "ADMIN", tempPassword: "Different123" })).toEqual({ createdAccount: false });
    expect(await verifyPassword("TempPassword1", (await db.user.findUniqueOrThrow({ where: { email } })).passwordHash)).toBe(true);

    const ownerMembership = await db.workspaceMembership.findFirstOrThrow({ where: { workspaceId, userId: ownerId } });
    await expect(changeMemberRole(workspaceId, ownerId, ownerMembership.id, "MEMBER")).rejects.toThrow("your own role");
    await expect(removeMember(workspaceId, ownerId, ownerMembership.id)).rejects.toThrow("remove yourself");

    await changeMemberRole(workspaceId, ownerId, member.id, "OWNER");
    // With two owners one may be demoted, but never the last one.
    await changeMemberRole(workspaceId, memberUser.id, ownerMembership.id, "ADMIN");
    await expect(changeMemberRole(workspaceId, ownerId, member.id, "ADMIN")).rejects.toThrow("at least one owner");
    await changeMemberRole(workspaceId, memberUser.id, ownerMembership.id, "OWNER");

    await db.session.create({ data: { tokenHash: `mem-${Date.now()}`, userId: memberUser.id, workspaceId, expiresAt: new Date(Date.now() + 86_400_000) } });
    await removeMember(workspaceId, ownerId, member.id);
    expect(await db.workspaceMembership.findUnique({ where: { id: member.id } })).toBeNull();
    expect(await db.session.count({ where: { userId: memberUser.id, workspaceId } })).toBe(0);
    // Their membership in the other workspace is untouched.
    expect(await db.workspaceMembership.count({ where: { userId: memberUser.id, workspaceId: ws2 } })).toBe(1);
  });
});
