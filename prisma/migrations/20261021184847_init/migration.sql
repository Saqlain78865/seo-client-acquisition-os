-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
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
    "crawlPageLimit" INTEGER NOT NULL DEFAULT 40,
    "crawlDelayMs" INTEGER NOT NULL DEFAULT 800,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "followUpDefaultDays" TEXT NOT NULL DEFAULT '3,7',
    CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PipelineStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PipelineStatus_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prospect" (
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
    "nextFollowUpAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prospect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prospect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProspectContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "sourceUrl" TEXT,
    "sourceMethod" TEXT NOT NULL DEFAULT 'MANUAL',
    "extractedAt" DATETIME,
    "validationStatus" TEXT NOT NULL DEFAULT 'UNCHECKED',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "conflictNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProspectContact_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeetingNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "meetingAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingNote_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "proposalId" TEXT,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'OPEN',
    "value" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "closedAt" DATETIME,
    "lostReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "proposalId" TEXT,
    "type" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" DATETIME,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebsiteAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "inputUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "summary" TEXT,
    "analysis" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteAudit_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "output" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "AuditRun_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrawlJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "pageLimit" INTEGER NOT NULL,
    "delayMs" INTEGER NOT NULL,
    "pagesFound" INTEGER NOT NULL DEFAULT 0,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "robotsTxt" TEXT,
    "sitemapUrls" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "CrawlJob_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrawledPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "httpStatus" INTEGER,
    "title" TEXT,
    "metaDescription" TEXT,
    "canonical" TEXT,
    "h1" JSONB,
    "headings" JSONB,
    "wordCount" INTEGER,
    "internalLinks" JSONB,
    "externalLinks" JSONB,
    "images" JSONB,
    "structuredData" JSONB,
    "robotsMeta" TEXT,
    "xRobotsTag" TEXT,
    "lang" TEXT,
    "pageType" TEXT,
    "contentHash" TEXT,
    "textExcerpt" TEXT,
    "rendered" BOOLEAN NOT NULL DEFAULT false,
    "responseTimeMs" INTEGER,
    "bytes" INTEGER,
    "extractionError" TEXT,
    "crawledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawledPage_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "findingId" TEXT,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "excerpt" TEXT,
    "measurement" JSONB,
    "method" TEXT NOT NULL,
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceSource_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvidenceSource_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "evidenceStatus" TEXT NOT NULL,
    "affectedUrls" JSONB NOT NULL,
    "observedFacts" TEXT NOT NULL,
    "businessImpact" TEXT,
    "recommendation" TEXT NOT NULL,
    "complexity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "confidence" TEXT NOT NULL DEFAULT 'HIGH',
    "verificationMethod" TEXT,
    "requiresAccess" BOOLEAN NOT NULL DEFAULT false,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "resolutionStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "includeInProposal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeywordCluster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "name" TEXT NOT NULL,
    "intent" TEXT,
    "targetUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeywordCluster_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Keyword" (
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
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Keyword_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Keyword_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "KeywordCluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT,
    "domain" TEXT NOT NULL,
    "businessName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Competitor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitorObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "data" JSONB,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorObservation_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" REAL,
    "setupFee" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deliverables" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingPackage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Proposal" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Proposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
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
    "createdById" TEXT,
    "changeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProposalSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProposalSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProposalAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PDF',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalAttachment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "accountLabel" TEXT,
    "encryptedSecret" TEXT,
    "config" JSONB,
    "lastSyncAt" DATETIME,
    "lastTestedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "WhatsAppDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "channelMethod" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "messagePreview" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppDelivery_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lastError" TEXT,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BackgroundJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_userId_workspaceId_key" ON "WorkspaceMembership"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStatus_workspaceId_key_key" ON "PipelineStatus"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "Prospect_workspaceId_status_idx" ON "Prospect"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Prospect_workspaceId_domain_idx" ON "Prospect"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "Prospect_workspaceId_createdAt_idx" ON "Prospect"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectContact_prospectId_type_value_key" ON "ProspectContact"("prospectId", "type", "value");

-- CreateIndex
CREATE INDEX "FollowUp_workspaceId_status_dueAt_idx" ON "FollowUp"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_createdAt_idx" ON "ActivityLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_prospectId_createdAt_idx" ON "ActivityLog"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_workspaceId_createdAt_idx" ON "WebsiteAudit"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRun_auditId_stage_key" ON "AuditRun"("auditId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlJob_auditId_key" ON "CrawlJob"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawledPage_auditId_url_key" ON "CrawledPage"("auditId", "url");

-- CreateIndex
CREATE INDEX "AuditFinding_auditId_severity_idx" ON "AuditFinding"("auditId", "severity");

-- CreateIndex
CREATE INDEX "Keyword_workspaceId_prospectId_idx" ON "Keyword"("workspaceId", "prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_shareToken_key" ON "Proposal"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_version_key" ON "ProposalVersion"("proposalId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_workspaceId_provider_key" ON "IntegrationConnection"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_idempotencyKey_key" ON "EmailDelivery"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppDelivery_idempotencyKey_key" ON "WhatsAppDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAfter_idx" ON "BackgroundJob"("status", "runAfter");
