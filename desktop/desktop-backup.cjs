// Copies the live database to a file with SQLite's online backup, so the copy is consistent even
// while the app is running. Usage: node desktop-backup.cjs <database file> <copy to>
const Database = require("better-sqlite3");

const [dbPath, dest] = process.argv.slice(2);
if (!dbPath || !dest) {
  console.error("usage: desktop-backup.cjs <database> <destination>");
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.backup(dest)
  .then(() => {
    db.close();
    console.log(`backed up to ${dest}`);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
