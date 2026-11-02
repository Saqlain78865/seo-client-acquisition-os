-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN "calendarEventId" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "repliedAt" DATETIME;

-- CreateTable
CREATE TABLE "GmailReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT,
    "snippet" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GmailReply_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "storageKey" TEXT,
    "seconds" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuditVideo_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GmailReply_prospectId_receivedAt_idx" ON "GmailReply"("prospectId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GmailReply_workspaceId_messageId_key" ON "GmailReply"("workspaceId", "messageId");

-- CreateIndex
CREATE INDEX "AuditVideo_prospectId_createdAt_idx" ON "AuditVideo"("prospectId", "createdAt");
