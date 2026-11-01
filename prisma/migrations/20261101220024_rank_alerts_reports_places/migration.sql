-- AlterTable
ALTER TABLE "GbpProfile" ADD COLUMN "competitors" JSONB;
ALTER TABLE "GbpProfile" ADD COLUMN "lat" REAL;
ALTER TABLE "GbpProfile" ADD COLUMN "lng" REAL;

-- CreateTable
CREATE TABLE "TrackedKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedKeyword_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackedKeyword_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeywordPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackedKeywordId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "position" REAL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "KeywordPosition_trackedKeywordId_fkey" FOREIGN KEY ("trackedKeywordId") REFERENCES "TrackedKeyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SiteAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "url" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "SiteAlert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SiteAlert_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "approvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "ReportDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportDelivery_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MapsGridScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "centerLat" REAL NOT NULL,
    "centerLng" REAL NOT NULL,
    "spacingKm" REAL NOT NULL,
    "size" INTEGER NOT NULL,
    "points" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MapsGridScan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MapsGridScan_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Website" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OWN',
    "gscSiteUrl" TEXT,
    "changesCheckedAt" DATETIME,
    "reportDay" INTEGER,
    "reportEmail" TEXT,
    "reportApproval" BOOLEAN NOT NULL DEFAULT true,
    "siteStatus" TEXT,
    "siteCheckedAt" DATETIME,
    "siteFailures" INTEGER NOT NULL DEFAULT 0,
    "keywordsSyncedAt" DATETIME,
    "trafficCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Website_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Website" ("changesCheckedAt", "createdAt", "domain", "gscSiteUrl", "id", "kind", "name", "url", "workspaceId") SELECT "changesCheckedAt", "createdAt", "domain", "gscSiteUrl", "id", "kind", "name", "url", "workspaceId" FROM "Website";
DROP TABLE "Website";
ALTER TABLE "new_Website" RENAME TO "Website";
CREATE UNIQUE INDEX "Website_workspaceId_domain_key" ON "Website"("workspaceId", "domain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TrackedKeyword_websiteId_keyword_key" ON "TrackedKeyword"("websiteId", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordPosition_trackedKeywordId_date_key" ON "KeywordPosition"("trackedKeywordId", "date");

-- CreateIndex
CREATE INDEX "SiteAlert_workspaceId_createdAt_idx" ON "SiteAlert"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAlert_websiteId_dedupeKey_key" ON "SiteAlert"("websiteId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDelivery_websiteId_month_key" ON "ReportDelivery"("websiteId", "month");

-- CreateIndex
CREATE INDEX "MapsGridScan_prospectId_createdAt_idx" ON "MapsGridScan"("prospectId", "createdAt");
