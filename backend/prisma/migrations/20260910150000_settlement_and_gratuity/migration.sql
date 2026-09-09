-- Full and final settlement, plus the gratuity and leave-encashment settings
-- it needs. All additive: existing rows take the defaults.

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- Gratuity and encashment parameters, held as data like every other rate.
ALTER TABLE "statutory_configs"
  ADD COLUMN "gratuityEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "gratuityDaysPerYear" DECIMAL(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN "gratuityMonthDays" DECIMAL(5,2) NOT NULL DEFAULT 26,
  ADD COLUMN "gratuityMinYears" DECIMAL(5,2) NOT NULL DEFAULT 5,
  ADD COLUMN "gratuityExemptionCap" DECIMAL(12,2) NOT NULL DEFAULT 2000000,
  ADD COLUMN "leaveEncashmentEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "encashmentMonthDays" DECIMAL(5,2) NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "separationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "lastWorkingDate" TIMESTAMP(3) NOT NULL,
    "proRataSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leaveEncashmentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "leaveEncashment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gratuity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gratuityExempt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherEarnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "noticeShortfallDays" INTEGER NOT NULL DEFAULT 0,
    "noticeRecovery" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherRecoveries" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossPayable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalRecoveries" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "remarks" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One settlement per separation.
CREATE UNIQUE INDEX "settlements_separationId_key" ON "settlements"("separationId");
CREATE INDEX "settlements_tenantId_idx" ON "settlements"("tenantId");
CREATE INDEX "settlements_employeeId_idx" ON "settlements"("employeeId");

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_separationId_fkey" FOREIGN KEY ("separationId") REFERENCES "separations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
