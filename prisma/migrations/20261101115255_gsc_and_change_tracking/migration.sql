-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "changesCheckedAt" DATETIME;
ALTER TABLE "Prospect" ADD COLUMN "gscSiteUrl" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "gscSyncedAt" DATETIME;

-- CreateTable
CREATE TABLE "GscDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL NOT NULL,
    "position" REAL NOT NULL,
    CONSTRAINT "GscDaily_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PageSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
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
    CONSTRAINT "PageSnapshot_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SiteChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteChange_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GscDaily_prospectId_date_key" ON "GscDaily"("prospectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PageSnapshot_prospectId_url_key" ON "PageSnapshot"("prospectId", "url");

-- CreateIndex
CREATE INDEX "SiteChange_prospectId_detectedAt_idx" ON "SiteChange"("prospectId", "detectedAt");
