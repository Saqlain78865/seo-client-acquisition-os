-- AlterTable
ALTER TABLE "WhatsAppDelivery" ADD COLUMN "templateName" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmailDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "templateId" TEXT,
    "bodySha256" TEXT,
    "followUpsScheduled" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "channelMethod" TEXT NOT NULL,
    "sender" TEXT,
    "recipient" TEXT NOT NULL,
    "cc" TEXT,
    "bcc" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "EmailDelivery_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmailDelivery" ("attempts", "bcc", "cc", "channelMethod", "createdAt", "error", "id", "idempotencyKey", "proposalId", "providerMessageId", "recipient", "sender", "sentAt", "status", "subject", "versionNumber") SELECT "attempts", "bcc", "cc", "channelMethod", "createdAt", "error", "id", "idempotencyKey", "proposalId", "providerMessageId", "recipient", "sender", "sentAt", "status", "subject", "versionNumber" FROM "EmailDelivery";
DROP TABLE "EmailDelivery";
ALTER TABLE "new_EmailDelivery" RENAME TO "EmailDelivery";
CREATE UNIQUE INDEX "EmailDelivery_idempotencyKey_key" ON "EmailDelivery"("idempotencyKey");
CREATE TABLE "new_Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "auditId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "shareToken" TEXT,
    "shareExpiresAt" DATETIME,
    "shareRevoked" BOOLEAN NOT NULL DEFAULT false,
    "shareVersion" INTEGER,
    "shareViews" INTEGER NOT NULL DEFAULT 0,
    "shareLastViewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Proposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Proposal" ("auditId", "createdAt", "currentVersion", "id", "prospectId", "shareExpiresAt", "shareRevoked", "shareToken", "status", "title", "updatedAt", "workspaceId") SELECT "auditId", "createdAt", "currentVersion", "id", "prospectId", "shareExpiresAt", "shareRevoked", "shareToken", "status", "title", "updatedAt", "workspaceId" FROM "Proposal";
DROP TABLE "Proposal";
ALTER TABLE "new_Proposal" RENAME TO "Proposal";
CREATE UNIQUE INDEX "Proposal_shareToken_key" ON "Proposal"("shareToken");
CREATE TABLE "new_Prospect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "industry" TEXT,
    "country" TEXT,
    "city" TEXT,
    "primaryServices" TEXT,
    "notes" TEXT,
    "leadSource" TEXT,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW_PROSPECT',
    "estimatedValue" REAL,
    "wonValue" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lostReason" TEXT,
    "objections" TEXT,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "doNotContactReason" TEXT,
    "nextFollowUpAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prospect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prospect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Prospect" ("businessName", "city", "country", "createdAt", "currency", "domain", "estimatedValue", "id", "industry", "lastActivityAt", "leadSource", "lostReason", "nextFollowUpAt", "notes", "objections", "ownerId", "primaryServices", "status", "updatedAt", "websiteUrl", "wonValue", "workspaceId") SELECT "businessName", "city", "country", "createdAt", "currency", "domain", "estimatedValue", "id", "industry", "lastActivityAt", "leadSource", "lostReason", "nextFollowUpAt", "notes", "objections", "ownerId", "primaryServices", "status", "updatedAt", "websiteUrl", "wonValue", "workspaceId" FROM "Prospect";
DROP TABLE "Prospect";
ALTER TABLE "new_Prospect" RENAME TO "Prospect";
CREATE INDEX "Prospect_workspaceId_status_idx" ON "Prospect"("workspaceId", "status");
CREATE INDEX "Prospect_workspaceId_domain_idx" ON "Prospect"("workspaceId", "domain");
CREATE INDEX "Prospect_workspaceId_createdAt_idx" ON "Prospect"("workspaceId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
