-- Corrections to the tax computation: age-banded basic exemption, Chapter VI-A
-- ceilings, marginal relief on surcharge, half-yearly professional tax, and the
-- section 10(10AA) exemption on leave encashment.
--
-- Additive apart from the income tax config unique key, which gains the age
-- band. Existing rows take GENERAL, which is the band they already described,
-- so nothing changes for an installation that does not seed senior slabs.

-- CreateEnum
CREATE TYPE "TaxAgeBand" AS ENUM ('GENERAL', 'SENIOR', 'SUPER_SENIOR');

-- Income tax configuration: age band and the ceilings the Act sets.
ALTER TABLE "income_tax_configs"
  ADD COLUMN "ageBand" "TaxAgeBand" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "section80CLimit" DECIMAL(12,2) NOT NULL DEFAULT 150000,
  ADD COLUMN "section80DLimit" DECIMAL(12,2) NOT NULL DEFAULT 25000,
  ADD COLUMN "section80CCD1BLimit" DECIMAL(12,2) NOT NULL DEFAULT 50000,
  ADD COLUMN "marginalReliefEnabled" BOOLEAN NOT NULL DEFAULT true;

-- The old key cannot stand once one year and regime can hold three bands.
DROP INDEX IF EXISTS "income_tax_configs_tenantId_financialYear_regime_key";
CREATE UNIQUE INDEX "income_tax_configs_tenantId_financialYear_regime_ageBand_key"
  ON "income_tax_configs"("tenantId", "financialYear", "regime", "ageBand");

-- Professional tax: the months a state actually collects in. Empty means every
-- month, which is what this did before the column existed.
ALTER TABLE "statutory_configs"
  ADD COLUMN "ptMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Section 10(10AA) parameters for leave encashment on exit.
ALTER TABLE "statutory_configs"
  ADD COLUMN "encashmentExemptionCap" DECIMAL(12,2) NOT NULL DEFAULT 2500000,
  ADD COLUMN "encashmentExemptDaysPerYear" DECIMAL(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN "encashmentExemptMonths" DECIMAL(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN "encashmentGovernmentEmployer" BOOLEAN NOT NULL DEFAULT false;

-- The exempt part of leave encashment, as a column rather than only a figure
-- inside the breakdown JSON, so it can be totalled across settlements the way
-- gratuity's exempt part already can.
ALTER TABLE "settlements"
  ADD COLUMN "leaveEncashmentExempt" DECIMAL(12,2) NOT NULL DEFAULT 0;
