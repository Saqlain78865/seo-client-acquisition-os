// Account recovery for someone with access to the server: npm run reset-password -- <email> <new password>
// Sets a new password, signs the user out everywhere and clears their failed-login lockout.
// There is deliberately no web "forgot password" flow: the app sends no email on its own.
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  process.loadEnvFile?.(".env");
} catch {
  // no .env: rely on the real environment
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: npm run reset-password -- <email> <new password>");
  process.exit(1);
}
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Use at least 10 characters, with a letter and a number.");
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? "file:./dev.db";
if (!url.startsWith("file:")) {
  console.error("This script supports the SQLite database. For PostgreSQL see docs/TROUBLESHOOTING.md.");
  process.exit(1);
}

const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const db = new Database(path.resolve(url.slice("file:".length)), { fileMustExist: true });
const normalised = email.trim().toLowerCase();
const user = db.prepare("SELECT id FROM User WHERE email = ?").get(normalised);
if (!user) {
  console.error(`No account with the email ${normalised}.`);
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
db.transaction(() => {
  db.prepare("UPDATE User SET passwordHash = ?, updatedAt = ? WHERE id = ?").run(hash, Date.now(), user.id);
  db.prepare("DELETE FROM Session WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM LoginAttempt WHERE email = ? AND success = 0").run(normalised);
})();
db.close();
console.log(`Password reset for ${normalised}. All their sessions were signed out. Ask them to change it after signing in.`);
