import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { db } from "./db";
import { logger } from "./log";
import { notify } from "./notifications";
import { GoogleApiError, googleJson, googleToken } from "./google-api";

/**
 * Daily backup of the app's database to the user's Google Drive, in a "LeadLift backups" folder.
 * The drive.file permission only lets the app see files it created. The last 14 backups are kept.
 * Saved Google, email and API keys stay encrypted in the copy; the key that unlocks them is not
 * uploaded (after a restore on a new computer, connections are made again).
 */

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size";
const FOLDER = "LeadLift backups";
export const KEEP = 14;
const log = logger("drive-backup");

/** A consistent copy of the live SQLite database (VACUUM INTO, safe while the app runs), gzipped. */
export async function databaseSnapshot() {
  const tmp = path.join(os.tmpdir(), `leadlift-backup-${process.pid}-${Date.now()}.db`);
  await db.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  try {
    return gzipSync(await fs.readFile(tmp), { level: 9 });
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

async function folderId(tok: string, fetchImpl: typeof fetch) {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await googleJson<{ files?: { id: string }[] }>(tok, `${DRIVE}?q=${q}&fields=files(id)&spaces=drive`, {}, fetchImpl);
  if (found.files?.[0]) return found.files[0].id;
  const made = await googleJson<{ id: string }>(tok, `${DRIVE}?fields=id`, { body: { name: FOLDER, mimeType: "application/vnd.google-apps.folder" } }, fetchImpl);
  return made.id;
}

export async function backupToDrive(workspaceId: string, fetchImpl: typeof fetch = fetch, now = new Date()) {
  const tok = await googleToken(workspaceId, "GOOGLE_DRIVE", fetchImpl);
  if (!tok) throw new GoogleApiError("Connect Google Drive on the Integrations page first.");
  const data = await databaseSnapshot();
  const parent = await folderId(tok, fetchImpl);
  const name = `leadlift-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.db.gz`;
  const boundary = `leadlift${Date.now()}`;
  const meta = JSON.stringify({ name, parents: [parent], description: "LeadLift database backup (gzip). Restore: unzip and use as data.db." });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/gzip\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetchImpl(UPLOAD, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(300_000) });
  const uploaded = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !uploaded.id) throw new GoogleApiError(`Google Drive upload failed: ${uploaded.error?.message ?? `HTTP ${res.status}`}`);
  // Older backups beyond the newest KEEP are deleted.
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  const all = await googleJson<{ files?: { id: string; name: string }[] }>(tok, `${DRIVE}?q=${q}&orderBy=createdTime desc&fields=files(id,name)&pageSize=100`, {}, fetchImpl);
  const old = (all.files ?? []).filter((f) => f.name.startsWith("leadlift-")).slice(KEEP);
  for (const f of old) await googleJson(tok, `${DRIVE}/${f.id}`, { method: "DELETE" }, fetchImpl).catch(() => {});
  const conn = await db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "GOOGLE_DRIVE" } }, select: { config: true } });
  await db.integrationConnection.update({
    where: { workspaceId_provider: { workspaceId, provider: "GOOGLE_DRIVE" } },
    data: { config: { ...((conn?.config as object) ?? {}), retryAfter: null, lastBackupAt: now.toISOString(), lastBackupName: name, lastBackupBytes: data.length }, lastError: null, lastTestedAt: now },
  });
  return { name, bytes: data.length, removed: old.length };
}

/** Daily: workspaces with Drive connected and no backup in the last 20 hours. */
export async function runDriveBackups(now = new Date()) {
  const conns = await db.integrationConnection.findMany({ where: { provider: "GOOGLE_DRIVE", status: "CONNECTED", encryptedSecret: { not: null } }, select: { workspaceId: true, config: true } });
  for (const c of conns) {
    const cfg = (c.config as { lastBackupAt?: string; retryAfter?: string } | null) ?? {};
    if (cfg.lastBackupAt && now.getTime() - Date.parse(cfg.lastBackupAt) < 20 * 3600_000) continue;
    if (cfg.retryAfter && Date.parse(cfg.retryAfter) > now.getTime()) continue;
    await backupToDrive(c.workspaceId, fetch, now).catch(async (e) => {
      log.warn("drive backup failed", { workspaceId: c.workspaceId, reason: (e as Error).message });
      const conn = await db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId: c.workspaceId, provider: "GOOGLE_DRIVE" } }, select: { config: true } });
      // Tried again in four hours rather than every tick.
      await db.integrationConnection.update({ where: { workspaceId_provider: { workspaceId: c.workspaceId, provider: "GOOGLE_DRIVE" } }, data: { lastError: (e as Error).message.slice(0, 500), config: { ...((conn?.config as object) ?? {}), retryAfter: new Date(now.getTime() + 4 * 3600_000).toISOString() } } });
      await notify({ workspaceId: c.workspaceId, title: "Google Drive backup failed", body: (e as Error).message.slice(0, 300), link: "/integrations" });
    });
  }
}
