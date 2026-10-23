// Runs before the E2E web server starts: fresh SQLite file with all migrations applied.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("e2e.db");
for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
execSync("node node_modules/prisma/build/index.js migrate deploy", { env: { ...process.env, DATABASE_URL: "file:./e2e.db" }, stdio: "inherit" });
