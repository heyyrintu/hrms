-- Investment proofs: evidence for a declared deduction, and its review.
--
-- All additive. Existing rows take the defaults, and because
-- proofVerificationRequired defaults to false, an installation that does not
-- opt in keeps taking declarations at face value exactly as it did before.

-- CreateEnum
CREATE TYPE "InvestmentProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "InvestmentProofSection" AS ENUM (
  'SECTION_80C',
  'SECTION_80D',
  'SECTION_80CCD1B',
  'HRA',
  'HOME_LOAN_INTEREST',
  'OTHER_DEDUCTIONS',
  'PREVIOUS_EMPLOYER_TDS'
);

-- Tenant switch and the month verified amounts take over from declared ones.
ALTER TABLE "statutory_configs"
  ADD COLUMN "proofVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "proofCutoffMonth" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "investment_proofs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "section" "InvestmentProofSection" NOT NULL,
    "status" "InvestmentProofStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAmount" DECIMAL(12,2) NOT NULL,
    "verifiedAmount" DECIMAL(12,2),
    "uploadId" TEXT NOT NULL,
    "description" VARCHAR(500),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_proofs_tenantId_financialYear_idx" ON "investment_proofs"("tenantId", "financialYear");
CREATE INDEX "investment_proofs_employeeId_financialYear_idx" ON "investment_proofs"("employeeId", "financialYear");
CREATE INDEX "investment_proofs_tenantId_status_idx" ON "investment_proofs"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "investment_proofs" ADD CONSTRAINT "investment_proofs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investment_proofs" ADD CONSTRAINT "investment_proofs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investment_proofs" ADD CONSTRAINT "investment_proofs_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One document per head per year. Two proofs pointing at the same upload under
-- one head would both be summed once approved, inflating a deduction and
-- under-deducting tax. The same document may still support a different head.
CREATE UNIQUE INDEX "investment_proofs_claim_key"
  ON "investment_proofs"("tenantId", "employeeId", "financialYear", "section", "uploadId");
