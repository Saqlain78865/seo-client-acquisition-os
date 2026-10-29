-- AlterTable
ALTER TABLE "ProposalResponse" ADD COLUMN "signature" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "reviewLink" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN "paymentInstructions" TEXT;
