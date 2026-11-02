-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "emailHealth" JSONB;
ALTER TABLE "Prospect" ADD COLUMN "techCheckedAt" DATETIME;
ALTER TABLE "Prospect" ADD COLUMN "techStack" JSONB;

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentPlan_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentPlanItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "linkTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ContentPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContentPlan_websiteId_createdAt_idx" ON "ContentPlan"("websiteId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentPlanItem_planId_month_idx" ON "ContentPlanItem"("planId", "month");
