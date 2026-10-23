// Backup: npm run backup [targetDir]
// Copies the SQLite database with SQLite's online backup API (safe while the app is running) and the
// private file storage (proposal PDFs, logos) into <targetDir>/<timestamp>/. Default target: ./backups
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  process.loadEnvFile?.(".env");
} catch {
  // no .env: rely on the real environment
}

const url = process.env.DATABASE_URL ?? "file:./dev.db";
if (!url.startsWith("file:")) {
  console.error("DATABASE_URL is not a SQLite file. For PostgreSQL use pg_dump (see docs/DEPLOYMENT.md).");
  process.exit(1);
}
const dbFile = path.resolve(url.slice("file:".length));
const storageDir = path.resolve(process.env.STORAGE_DIR ?? "storage");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = path.resolve(process.argv[2] ?? "backups", stamp);

if (!fs.existsSync(dbFile)) {
  console.error(`Database file not found: ${dbFile}`);
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });

const Database = require("better-sqlite3");
const db = new Database(dbFile, { readonly: true, fileMustExist: true });
await db.backup(path.join(target, path.basename(dbFile)));
db.close();

// Verify the copy opens and has data before calling it a success.
const check = new Database(path.join(target, path.basename(dbFile)), { readonly: true });
const users = check.prepare("SELECT COUNT(*) AS n FROM User").get().n;
const integrity = check.prepare("PRAGMA integrity_check").get().integrity_check;
check.close();
if (integrity !== "ok") {
  console.error(`Backup integrity check failed: ${integrity}`);
  process.exit(1);
}

let files = 0;
if (fs.existsSync(storageDir)) {
  fs.cpSync(storageDir, path.join(target, "storage"), { recursive: true });
  files = fs.readdirSync(path.join(target, "storage"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
}

console.log(`Backup written to ${target}`);
console.log(`  database: ${path.basename(dbFile)} (${users} user${users === 1 ? "" : "s"}, integrity ok)`);
console.log(`  storage:  ${files} file${files === 1 ? "" : "s"}${fs.existsSync(storageDir) ? "" : " (no storage folder yet)"}`);
console.log("Keep backups off this machine too, and note that ENCRYPTION_KEY is needed to read saved integration credentials.");
