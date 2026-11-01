import path from "node:path";

process.env.DATABASE_URL = `file:${path.resolve(__dirname, "../test.db")}`;
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
// Tests never touch the real ./storage folder (the retention sweep deletes files there).
process.env.STORAGE_DIR = path.resolve(__dirname, "../test-storage");
process.env.DISABLE_MAINTENANCE = "true";
process.env.DISABLE_CAMPAIGNS = "true";
process.env.DISABLE_REAUDITS = "true";
process.env.DISABLE_TRACKING = "true";
