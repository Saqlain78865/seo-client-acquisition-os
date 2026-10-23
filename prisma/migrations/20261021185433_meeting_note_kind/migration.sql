-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MeetingNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "meetingAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingNote_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MeetingNote" ("authorId", "body", "createdAt", "id", "meetingAt", "prospectId") SELECT "authorId", "body", "createdAt", "id", "meetingAt", "prospectId" FROM "MeetingNote";
DROP TABLE "MeetingNote";
ALTER TABLE "new_MeetingNote" RENAME TO "MeetingNote";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
