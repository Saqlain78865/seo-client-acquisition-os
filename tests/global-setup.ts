import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Each test run gets a fresh SQLite database with all migrations applied.
export default function setup() {
  const file = path.resolve(__dirname, "../test.db");
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `file:${file}` },
    stdio: "ignore",
  });
}
