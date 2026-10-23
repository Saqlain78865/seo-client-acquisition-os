-- CreateTable
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "columnMap" JSONB,
    "periodLabel" TEXT,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "importedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DataImport_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferringDomain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "authority" REAL,
    "authorityMetric" TEXT,
    "backlinks" INTEGER,
    "dofollow" BOOLEAN,
    "firstSeen" DATETIME,
    CONSTRAINT "ReferringDomain_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReferringDomain_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchConsoleRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL,
    "position" REAL,
    CONSTRAINT "SearchConsoleRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SearchConsoleRow_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PerformanceTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "auditId" TEXT,
    "url" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "performanceScore" REAL,
    "lab" JSONB,
    "field" JSONB,
    "fieldScope" TEXT NOT NULL DEFAULT 'NONE',
    "error" TEXT,
    "testedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceTest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PerformanceTest_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Competitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "domain" TEXT NOT NULL,
    "businessName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Competitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Competitor_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Competitor" ("businessName", "createdAt", "domain", "id", "notes", "prospectId", "source", "workspaceId") SELECT "businessName", "createdAt", "domain", "id", "notes", "prospectId", "source", "workspaceId" FROM "Competitor";
DROP TABLE "Competitor";
ALTER TABLE "new_Competitor" RENAME TO "Competitor";
CREATE TABLE "new_Keyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "clusterId" TEXT,
    "keyword" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "language" TEXT,
    "intent" TEXT,
    "funnelStage" TEXT,
    "searchVolume" INTEGER,
    "volumeIsEstimate" BOOLEAN NOT NULL DEFAULT true,
    "difficulty" REAL,
    "cpc" REAL,
    "currentRank" INTEGER,
    "dataSource" TEXT NOT NULL,
    "retrievedAt" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "targetUrl" TEXT,
    "recommendedPageType" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "importId" TEXT,
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Keyword_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Keyword_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "KeywordCluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Keyword_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Keyword_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Keyword" ("clusterId", "confidence", "country", "cpc", "createdAt", "currentRank", "dataSource", "difficulty", "funnelStage", "id", "intent", "keyword", "language", "priority", "prospectId", "recommendedPageType", "region", "retrievedAt", "searchVolume", "status", "targetUrl", "volumeIsEstimate", "workspaceId") SELECT "clusterId", "confidence", "country", "cpc", "createdAt", "currentRank", "dataSource", "difficulty", "funnelStage", "id", "intent", "keyword", "language", "priority", "prospectId", "recommendedPageType", "region", "retrievedAt", "searchVolume", "status", "targetUrl", "volumeIsEstimate", "workspaceId" FROM "Keyword";
DROP TABLE "Keyword";
ALTER TABLE "new_Keyword" RENAME TO "Keyword";
CREATE INDEX "Keyword_workspaceId_prospectId_idx" ON "Keyword"("workspaceId", "prospectId");
CREATE TABLE "new_KeywordCluster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "name" TEXT NOT NULL,
    "intent" TEXT,
    "targetUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeywordCluster_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeywordCluster_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KeywordCluster" ("createdAt", "id", "intent", "name", "prospectId", "targetUrl", "workspaceId") SELECT "createdAt", "id", "intent", "name", "prospectId", "targetUrl", "workspaceId" FROM "KeywordCluster";
DROP TABLE "KeywordCluster";
ALTER TABLE "new_KeywordCluster" RENAME TO "KeywordCluster";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DataImport_workspaceId_prospectId_kind_idx" ON "DataImport"("workspaceId", "prospectId", "kind");

-- CreateIndex
CREATE INDEX "ReferringDomain_prospectId_idx" ON "ReferringDomain"("prospectId");

-- CreateIndex
CREATE INDEX "SearchConsoleRow_prospectId_dimension_idx" ON "SearchConsoleRow"("prospectId", "dimension");

-- CreateIndex
CREATE INDEX "PerformanceTest_prospectId_testedAt_idx" ON "PerformanceTest"("prospectId", "testedAt");
