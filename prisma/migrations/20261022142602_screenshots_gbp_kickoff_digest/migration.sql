-- CreateTable
CREATE TABLE "AuditScreenshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ruleId" TEXT,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditScreenshot_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GbpProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "mapsUrl" TEXT,
    "category" TEXT,
    "rating" REAL,
    "reviewCount" INTEGER,
    "photoCount" INTEGER,
    "hasHours" BOOLEAN,
    "hasDescription" BOOLEAN,
    "businessStatus" TEXT,
    "reviews" JSONB NOT NULL,
    "rankings" JSONB NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GbpProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GbpProfile_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KickoffTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" DATETIME,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KickoffTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KickoffTask_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KickoffTask_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkspaceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "consultantName" TEXT,
    "companyName" TEXT,
    "companyEmail" TEXT,
    "companyPhone" TEXT,
    "companyWebsite" TEXT,
    "consultantWhatsApp" TEXT,
    "logoPath" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "proposalTheme" TEXT NOT NULL DEFAULT 'navy',
    "brandColor" TEXT,
    "crawlPageLimit" INTEGER NOT NULL DEFAULT 40,
    "crawlDelayMs" INTEGER NOT NULL DEFAULT 800,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "followUpDefaultDays" TEXT NOT NULL DEFAULT '3,7',
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "lastDigestAt" DATETIME,
    CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkspaceSettings" ("brandColor", "companyEmail", "companyName", "companyPhone", "companyWebsite", "consultantName", "consultantWhatsApp", "crawlDelayMs", "crawlPageLimit", "dataRetentionDays", "defaultCurrency", "followUpDefaultDays", "id", "logoPath", "proposalTheme", "workspaceId") SELECT "brandColor", "companyEmail", "companyName", "companyPhone", "companyWebsite", "consultantName", "consultantWhatsApp", "crawlDelayMs", "crawlPageLimit", "dataRetentionDays", "defaultCurrency", "followUpDefaultDays", "id", "logoPath", "proposalTheme", "workspaceId" FROM "WorkspaceSettings";
DROP TABLE "WorkspaceSettings";
ALTER TABLE "new_WorkspaceSettings" RENAME TO "WorkspaceSettings";
CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditScreenshot_auditId_idx" ON "AuditScreenshot"("auditId");

-- CreateIndex
CREATE INDEX "GbpProfile_prospectId_fetchedAt_idx" ON "GbpProfile"("prospectId", "fetchedAt");

-- CreateIndex
CREATE INDEX "KickoffTask_prospectId_sortOrder_idx" ON "KickoffTask"("prospectId", "sortOrder");
