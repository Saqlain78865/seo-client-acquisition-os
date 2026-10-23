-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "note" TEXT,
    "inProposal" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Keyword_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Keyword_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "KeywordCluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Keyword_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Keyword_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Keyword" ("clusterId", "confidence", "country", "cpc", "createdAt", "currentRank", "dataSource", "difficulty", "funnelStage", "id", "importId", "intent", "isSeed", "keyword", "language", "note", "priority", "prospectId", "recommendedPageType", "region", "retrievedAt", "searchVolume", "status", "targetUrl", "volumeIsEstimate", "workspaceId") SELECT "clusterId", "confidence", "country", "cpc", "createdAt", "currentRank", "dataSource", "difficulty", "funnelStage", "id", "importId", "intent", "isSeed", "keyword", "language", "note", "priority", "prospectId", "recommendedPageType", "region", "retrievedAt", "searchVolume", "status", "targetUrl", "volumeIsEstimate", "workspaceId" FROM "Keyword";
DROP TABLE "Keyword";
ALTER TABLE "new_Keyword" RENAME TO "Keyword";
CREATE INDEX "Keyword_workspaceId_prospectId_idx" ON "Keyword"("workspaceId", "prospectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
