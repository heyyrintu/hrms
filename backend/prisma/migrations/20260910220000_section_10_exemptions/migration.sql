-- Section 10 exemptions beyond house rent, and the proof heads that support
-- them. All additive: an installation that declares nothing new behaves
-- exactly as it did, because every column defaults to zero.

-- Leave travel concession, and the two section 10(14) allowances.
ALTER TABLE "employee_tax_declarations"
  ADD COLUMN "ltaExemption" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "childrenEducationAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "hostelAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "childrenCount" INTEGER NOT NULL DEFAULT 0;

-- The section 10(14) ceilings, held as data because they are statutory
-- figures that a Finance Act can move.
ALTER TABLE "income_tax_configs"
  ADD COLUMN "childrenEducationMonthlyLimit" DECIMAL(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN "hostelAllowanceMonthlyLimit" DECIMAL(10,2) NOT NULL DEFAULT 300,
  ADD COLUMN "childrenAllowanceMaxChildren" INTEGER NOT NULL DEFAULT 2;

-- Heads an employee can file evidence under.
ALTER TYPE "InvestmentProofSection" ADD VALUE 'LTA';
ALTER TYPE "InvestmentProofSection" ADD VALUE 'CHILDREN_EDUCATION';
ALTER TYPE "InvestmentProofSection" ADD VALUE 'HOSTEL_ALLOWANCE';
