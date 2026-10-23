-- AlterTable
ALTER TABLE "ProposalSection" ADD COLUMN "data" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProposalVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "monthlyPrice" REAL,
    "setupFee" REAL,
    "paymentTerms" TEXT,
    "roadmap" TEXT NOT NULL DEFAULT '90_DAY',
    "theme" TEXT NOT NULL DEFAULT 'navy',
    "title" TEXT,
    "proposalDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "durationMonths" INTEGER NOT NULL DEFAULT 6,
    "services" JSONB,
    "deliverables" JSONB,
    "clientNotes" TEXT,
    "includeAppendix" BOOLEAN NOT NULL DEFAULT true,
    "branding" JSONB,
    "createdById" TEXT,
    "changeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProposalVersion" ("changeNote", "createdAt", "createdById", "currency", "id", "locked", "monthlyPrice", "paymentTerms", "proposalId", "roadmap", "setupFee", "theme", "version") SELECT "changeNote", "createdAt", "createdById", "currency", "id", "locked", "monthlyPrice", "paymentTerms", "proposalId", "roadmap", "setupFee", "theme", "version" FROM "ProposalVersion";
DROP TABLE "ProposalVersion";
ALTER TABLE "new_ProposalVersion" RENAME TO "ProposalVersion";
CREATE UNIQUE INDEX "ProposalVersion_proposalId_version_key" ON "ProposalVersion"("proposalId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
