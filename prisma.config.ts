import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional when variables come from the environment (CI, hosting).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
