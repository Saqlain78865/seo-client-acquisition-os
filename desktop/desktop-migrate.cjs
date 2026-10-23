// Applies the app's database migrations in order, like `prisma migrate deploy`, using the same
// _prisma_migrations table so a database copied from a development install is recognised.
// Usage: node desktop-migrate.cjs <database file> <migrations folder>
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const [dbPath, dir] = process.argv.slice(2);
if (!dbPath || !dir) {
  console.error("usage: desktop-migrate.cjs <database> <migrations>");
  process.exit(2);
}

const db = new Database(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);

const applied = new Set(db.prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all().map((r) => r.migration_name));
const pending = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "migration.sql")))
  .map((d) => d.name)
  .sort()
  .filter((name) => !applied.has(name));

for (const name of pending) {
  const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
  const id = crypto.randomUUID();
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  db.prepare(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES (?, ?, ?, ?)`).run(id, checksum, name, new Date().toISOString());
  // Prisma's SQLite migrations manage foreign-key pragmas themselves, so they run as one script, not in a transaction.
  db.exec(sql);
  db.prepare(`UPDATE "_prisma_migrations" SET finished_at = ?, applied_steps_count = 1 WHERE id = ?`).run(new Date().toISOString(), id);
  console.log(`applied ${name}`);
}
console.log(pending.length ? `${pending.length} migration(s) applied` : "database is up to date");
db.close();
