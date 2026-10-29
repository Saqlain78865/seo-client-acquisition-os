-- AlterTable
ALTER TABLE "GbpProfile" ADD COLUMN "reviewChecks" JSONB;

-- CreateTable
CREATE TABLE "ReviewScreenshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewScreenshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewScreenshot_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReviewScreenshot_prospectId_createdAt_idx" ON "ReviewScreenshot"("prospectId", "createdAt");
