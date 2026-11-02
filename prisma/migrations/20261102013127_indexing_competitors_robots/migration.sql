-- AlterTable
ALTER TABLE "Website" ADD COLUMN "indexCheckedAt" DATETIME;
ALTER TABLE "Website" ADD COLUMN "robotsBody" TEXT;
ALTER TABLE "Website" ADD COLUMN "robotsCheckedAt" DATETIME;
ALTER TABLE "Website" ADD COLUMN "sitemapUrlCount" INTEGER;

-- CreateTable
CREATE TABLE "WatchedCompetitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "changesCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedCompetitor_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IndexStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "coverageState" TEXT,
    "robotsTxtState" TEXT,
    "indexingState" TEXT,
    "pageFetchState" TEXT,
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "lastCrawlTime" DATETIME,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndexStatus_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PageSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT,
    "websiteId" TEXT,
    "competitorId" TEXT,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT,
    "canonical" TEXT,
    "robotsMeta" TEXT,
    "wordCount" INTEGER,
    "contentHash" TEXT,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PageSnapshot_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PageSnapshot_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PageSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "WatchedCompetitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PageSnapshot" ("canonical", "contentHash", "h1", "id", "metaDescription", "prospectId", "robotsMeta", "status", "takenAt", "title", "url", "websiteId", "wordCount") SELECT "canonical", "contentHash", "h1", "id", "metaDescription", "prospectId", "robotsMeta", "status", "takenAt", "title", "url", "websiteId", "wordCount" FROM "PageSnapshot";
DROP TABLE "PageSnapshot";
ALTER TABLE "new_PageSnapshot" RENAME TO "PageSnapshot";
CREATE UNIQUE INDEX "PageSnapshot_prospectId_url_key" ON "PageSnapshot"("prospectId", "url");
CREATE UNIQUE INDEX "PageSnapshot_websiteId_url_key" ON "PageSnapshot"("websiteId", "url");
CREATE UNIQUE INDEX "PageSnapshot_competitorId_url_key" ON "PageSnapshot"("competitorId", "url");
CREATE TABLE "new_SiteChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "websiteId" TEXT,
    "competitorId" TEXT,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteChange_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SiteChange_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SiteChange_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "WatchedCompetitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SiteChange" ("after", "before", "detectedAt", "id", "kind", "prospectId", "url", "websiteId", "workspaceId") SELECT "after", "before", "detectedAt", "id", "kind", "prospectId", "url", "websiteId", "workspaceId" FROM "SiteChange";
DROP TABLE "SiteChange";
ALTER TABLE "new_SiteChange" RENAME TO "SiteChange";
CREATE INDEX "SiteChange_prospectId_detectedAt_idx" ON "SiteChange"("prospectId", "detectedAt");
CREATE INDEX "SiteChange_websiteId_detectedAt_idx" ON "SiteChange"("websiteId", "detectedAt");
CREATE INDEX "SiteChange_competitorId_detectedAt_idx" ON "SiteChange"("competitorId", "detectedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WatchedCompetitor_websiteId_domain_key" ON "WatchedCompetitor"("websiteId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "IndexStatus_websiteId_url_key" ON "IndexStatus"("websiteId", "url");
