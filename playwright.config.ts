import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// E2E runs against a production build with its own SQLite file, so it never touches dev data.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `node e2e/prepare-db.mjs && node node_modules/next/dist/bin/next start -p ${PORT}`,
    stdout: "pipe",
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Keys from .env are blanked: tests must be deterministic and must not use the owner's API quota.
    env: { DATABASE_URL: "file:./e2e.db", STORAGE_DIR: "e2e-storage", DISABLE_TRACKING: "true", GEMINI_API_KEY: "", PAGESPEED_API_KEY: "", GOOGLE_PLACES_API_KEY: "" },
  },
});
