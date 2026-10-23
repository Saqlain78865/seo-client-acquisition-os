-- AlterTable
ALTER TABLE "CrawlJob" ADD COLUMN "meta" JSONB;

-- AlterTable
ALTER TABLE "CrawledPage" ADD COLUMN "details" JSONB;
ALTER TABLE "CrawledPage" ADD COLUMN "discoveredVia" TEXT;
ALTER TABLE "CrawledPage" ADD COLUMN "linkedFrom" TEXT;
ALTER TABLE "CrawledPage" ADD COLUMN "redirectChain" JSONB;
