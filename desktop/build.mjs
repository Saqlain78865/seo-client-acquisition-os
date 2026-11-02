// Prepares desktop/build: the self-contained Next.js server, a Node runtime and the migrations.
// Then `electron-builder` turns desktop/app + desktop/build into the Windows installer.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(here, "build");
const step = (msg) => console.log(`\n▸ ${msg}`);

step("Building the app (standalone)");
execSync("npx next build", { cwd: root, stdio: "inherit", env: { ...process.env, NEXT_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" } });

const standalone = path.join(root, ".next", "standalone");
// Next puts server.js at the top, or one level down when it traces from a parent folder.
const serverJs = fs.existsSync(path.join(standalone, "server.js")) ? standalone : path.join(standalone, path.basename(root));
if (!fs.existsSync(path.join(serverJs, "server.js"))) throw new Error(`server.js not found under ${standalone}`);

step("Copying the server");
fs.rmSync(out, { recursive: true, force: true });
const server = path.join(out, "server");
fs.cpSync(serverJs, server, { recursive: true });
if (serverJs !== standalone) {
  // node_modules traced from the parent folder sit at the standalone root.
  const parentModules = path.join(standalone, "node_modules");
  if (fs.existsSync(parentModules)) fs.cpSync(parentModules, path.join(server, "node_modules"), { recursive: true });
}
fs.cpSync(path.join(root, ".next", "static"), path.join(server, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(server, "public"), { recursive: true });

// File tracing also picks up the project folder (sources, tests, .env, local databases, client files).
// Keep only what the server runs; settings come from the app and data lives in the user's folder.
const KEEP = new Set([".next", "node_modules", "public", "server.js", "package.json"]);
for (const name of fs.readdirSync(server)) {
  if (!KEEP.has(name)) fs.rmSync(path.join(server, name), { recursive: true, force: true });
}
console.log(`  kept ${[...KEEP].join(", ")}`);
// Tracing misses files Playwright loads at run time (browsers.json, protocol files), so ship it whole;
// mp4-muxer is read from disk into the browser page that makes audit videos.
for (const pkg of ["playwright", "playwright-core", "mp4-muxer"]) {
  fs.rmSync(path.join(server, "node_modules", pkg), { recursive: true, force: true });
  fs.cpSync(path.join(root, "node_modules", pkg), path.join(server, "node_modules", pkg), { recursive: true });
}
console.log("  copied playwright, playwright-core and mp4-muxer in full");
fs.copyFileSync(path.join(here, "desktop-migrate.cjs"), path.join(server, "desktop-migrate.cjs"));
fs.copyFileSync(path.join(here, "desktop-server.cjs"), path.join(server, "desktop-server.cjs"));
fs.copyFileSync(path.join(here, "desktop-backup.cjs"), path.join(server, "desktop-backup.cjs"));

step("Copying migrations");
fs.cpSync(path.join(root, "prisma", "migrations"), path.join(out, "migrations"), { recursive: true });

step("Copying the Node runtime");
fs.mkdirSync(path.join(out, "node"), { recursive: true });
fs.copyFileSync(process.execPath, path.join(out, "node", "node.exe"));
console.log(`  node ${process.version} (the server's native modules were built for this version)`);

step("Copying the app icon");
fs.copyFileSync(path.join(here, "assets", "icon.png"), path.join(here, "app", "icon.png"));

console.log("\n✓ desktop/build is ready");
