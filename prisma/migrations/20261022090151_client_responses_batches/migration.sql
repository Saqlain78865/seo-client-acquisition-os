-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN "acceptedAt" DATETIME;

-- CreateTable
CREATE TABLE "ProposalResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "message" TEXT,
    "version" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalResponse_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WebsiteAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "inputUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "requestedById" TEXT,
    "autoProposal" BOOLEAN NOT NULL DEFAULT false,
    "batchId" TEXT,
    "summary" TEXT,
    "analysis" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteAudit_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AuditBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteAudit" ("analysis", "completedAt", "context", "createdAt", "id", "inputUrl", "normalizedUrl", "prospectId", "startedAt", "status", "summary", "updatedAt", "workspaceId") SELECT "analysis", "completedAt", "context", "createdAt", "id", "inputUrl", "normalizedUrl", "prospectId", "startedAt", "status", "summary", "updatedAt", "workspaceId" FROM "WebsiteAudit";
DROP TABLE "WebsiteAudit";
ALTER TABLE "new_WebsiteAudit" RENAME TO "WebsiteAudit";
CREATE INDEX "WebsiteAudit_workspaceId_createdAt_idx" ON "WebsiteAudit"("workspaceId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ProposalResponse_proposalId_createdAt_idx" ON "ProposalResponse"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditBatch_workspaceId_createdAt_idx" ON "AuditBatch"("workspaceId", "createdAt");
