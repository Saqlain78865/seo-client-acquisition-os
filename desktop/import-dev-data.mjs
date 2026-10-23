// Copies the data of the browser version (dev.db, storage/, keys from .env) into the desktop app's
// data folder, so the desktop app opens with the same prospects, proposals and saved connections.
// Only copies — the originals are not changed. Refuses to overwrite an existing desktop database.
// Usage (desktop app closed):  node desktop/import-dev-data.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.SEO_OS_DATA_DIR ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "SEO Acquisition OS");

const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch {
  console.error("No .env found in the project folder.");
  process.exit(1);
}
const src = (env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
const srcDb = path.resolve(root, src);
const dstDb = path.join(target, "data.db");
if (!fs.existsSync(srcDb)) {
  console.error(`Database not found: ${srcDb}`);
  process.exit(1);
}
if (fs.existsSync(dstDb)) {
  console.error(`The desktop app already has data (${dstDb}). Nothing was copied.`);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(srcDb, dstDb);
const storage = path.resolve(root, env.STORAGE_DIR ?? "storage");
if (fs.existsSync(storage)) fs.cpSync(storage, path.join(target, "storage"), { recursive: true });

// The same encryption key is needed to read saved connections (Gmail, WhatsApp, API keys).
const configPath = path.join(target, "config.json");
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  // New config.
}
cfg.encryptionKey = env.ENCRYPTION_KEY;
cfg.env = { ...(cfg.env ?? {}) };
for (const k of ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_MODEL", "PAGESPEED_API_KEY", "GOOGLE_PLACES_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
  if (env[k]) cfg.env[k] = env[k];
}
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
console.log(`Copied the database${fs.existsSync(storage) ? ", files" : ""} and keys to ${target}`);
