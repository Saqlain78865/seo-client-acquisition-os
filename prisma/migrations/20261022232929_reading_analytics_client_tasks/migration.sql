-- CreateTable
CREATE TABLE "ProposalReadSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "sections" JSONB NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalReadSession_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "month" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientTask_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProposalReadSession_proposalId_lastSeenAt_idx" ON "ProposalReadSession"("proposalId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalReadSession_proposalId_visitorKey_key" ON "ProposalReadSession"("proposalId", "visitorKey");

-- CreateIndex
CREATE INDEX "ClientTask_workspaceId_month_idx" ON "ClientTask"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "ClientTask_prospectId_month_idx" ON "ClientTask"("prospectId", "month");
