-- Indian statutory payroll: PF, ESI, professional tax, LWF and TDS.
-- All rates and slabs are data, not code, because they change most years and
-- several vary by state.

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- Statutory identifiers on the employee record. All nullable: existing rows
-- have none, and PF/ESI/TDS filing needs them supplied before the first run.
ALTER TABLE "employees"
  ADD COLUMN "pan" VARCHAR(10),
  ADD COLUMN "uan" VARCHAR(12),
  ADD COLUMN "esiNumber" VARCHAR(17),
  ADD COLUMN "pfOptOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taxRegime" "TaxRegime",
  ADD COLUMN "bankAccountNumber" VARCHAR(20),
  ADD COLUMN "bankIfsc" VARCHAR(11),
  ADD COLUMN "bankName" VARCHAR(100);

-- Statutory amounts on the payslip. Defaulted to zero so payslips generated
-- before this migration keep totalling correctly.
ALTER TABLE "payslips"
  ADD COLUMN "pfWages" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pfEmployee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pfEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "epsEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "edliEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pfAdminEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "esiWages" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "esiEmployee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "esiEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "professionalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lwfEmployee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lwfEmployer" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tds" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxComputation" JSONB;

-- CreateTable
CREATE TABLE "statutory_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pfEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pfEmployeeRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "pfEmployerRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "epsRate" DECIMAL(5,2) NOT NULL DEFAULT 8.33,
    "pfWageCeiling" DECIMAL(12,2) NOT NULL DEFAULT 15000,
    "applyPfCeiling" BOOLEAN NOT NULL DEFAULT true,
    "edliRate" DECIMAL(5,2) NOT NULL DEFAULT 0.5,
    "pfAdminRate" DECIMAL(5,2) NOT NULL DEFAULT 0.5,
    "pfAdminMinimum" DECIMAL(12,2) NOT NULL DEFAULT 500,
    "esiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "esiEmployeeRate" DECIMAL(5,2) NOT NULL DEFAULT 0.75,
    "esiEmployerRate" DECIMAL(5,2) NOT NULL DEFAULT 3.25,
    "esiWageLimit" DECIMAL(12,2) NOT NULL DEFAULT 21000,
    "ptEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ptState" VARCHAR(50),
    "lwfEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lwfEmployeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lwfEmployerAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lwfMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "tdsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultTaxRegime" "TaxRegime" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_tax_slabs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "state" VARCHAR(50) NOT NULL,
    "fromAmount" DECIMAL(12,2) NOT NULL,
    "toAmount" DECIMAL(12,2),
    "amount" DECIMAL(10,2) NOT NULL,
    "februaryAmount" DECIMAL(10,2),
    "gender" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professional_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_tax_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "standardDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rebateIncomeLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rebateMaxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 4,
    "surchargeSlabs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_tax_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_tax_slabs" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "fromAmount" DECIMAL(14,2) NOT NULL,
    "toAmount" DECIMAL(14,2),
    "rate" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "income_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_tax_declarations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "section80C" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "section80D" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "section80CCD1B" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "section80CCD2" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hraExemption" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "homeLoanInterest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherIncome" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "previousEmployerTds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_tax_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "statutory_configs_tenantId_key" ON "statutory_configs"("tenantId");
CREATE INDEX "professional_tax_slabs_tenantId_state_idx" ON "professional_tax_slabs"("tenantId", "state");
CREATE INDEX "income_tax_configs_tenantId_idx" ON "income_tax_configs"("tenantId");
CREATE UNIQUE INDEX "income_tax_configs_tenantId_financialYear_regime_key" ON "income_tax_configs"("tenantId", "financialYear", "regime");
CREATE INDEX "income_tax_slabs_configId_idx" ON "income_tax_slabs"("configId");
CREATE INDEX "employee_tax_declarations_tenantId_idx" ON "employee_tax_declarations"("tenantId");
CREATE INDEX "employee_tax_declarations_employeeId_idx" ON "employee_tax_declarations"("employeeId");
CREATE UNIQUE INDEX "employee_tax_declarations_tenantId_employeeId_financialYear_key" ON "employee_tax_declarations"("tenantId", "employeeId", "financialYear");

-- AddForeignKey
ALTER TABLE "statutory_configs" ADD CONSTRAINT "statutory_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "professional_tax_slabs" ADD CONSTRAINT "professional_tax_slabs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "income_tax_configs" ADD CONSTRAINT "income_tax_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "income_tax_slabs" ADD CONSTRAINT "income_tax_slabs_configId_fkey" FOREIGN KEY ("configId") REFERENCES "income_tax_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_tax_declarations" ADD CONSTRAINT "employee_tax_declarations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tax_declarations" ADD CONSTRAINT "employee_tax_declarations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
