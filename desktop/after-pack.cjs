// electron-builder always leaves node_modules out of extraResources, but the bundled server needs its
// own copy (Next.js, Prisma's SQLite driver, Playwright). This hook adds it to the unpacked app before
// the installer is built.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "build", "server", "node_modules");
  const to = path.join(context.appOutDir, "resources", "server", "node_modules");
  if (!fs.existsSync(from)) throw new Error(`Missing ${from} — run node build.mjs first`);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  for (const required of ["next/package.json", "better-sqlite3/build/Release/better_sqlite3.node", "playwright-core/browsers.json"]) {
    if (!fs.existsSync(path.join(to, required))) throw new Error(`The packaged server is missing ${required}`);
  }
  console.log(`  • server node_modules added to ${to}`);
};
