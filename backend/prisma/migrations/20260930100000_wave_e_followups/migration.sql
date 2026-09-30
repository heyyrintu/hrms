-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ENGAGEMENT_RELEASE_FAILED';

-- AlterTable
ALTER TABLE "feed_items" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "feed_items_tenantId_expiresAt_idx" ON "feed_items"("tenantId", "expiresAt");

