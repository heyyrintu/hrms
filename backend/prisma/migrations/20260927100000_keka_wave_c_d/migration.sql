-- Keka waves C (payroll depth) and D (hiring).
-- Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
--
-- No workflow backfill: built-in approval chains live in code
-- (workflow.defaults.ts) and nothing of the new entity types (JOB_REQUISITION,
-- OFFER) is in flight yet. The enum values added below are not used inside
-- this migration, so ADD VALUE inside the migration transaction is safe
-- (PostgreSQL 12+), exactly as in 20260924100000_keka_wave_b.
--
-- Existing payroll runs become REGULAR with sequence 0; the per-month unique
-- key widens to (tenantId, month, year, runType, sequence) so off-cycle runs
-- can share a month with the regular run.

-- CreateEnum
CREATE TYPE "PayrollRunType" AS ENUM ('REGULAR', 'OFF_CYCLE');

-- CreateEnum
CREATE TYPE "OneTimePaymentKind" AS ENUM ('BONUS', 'INCENTIVE', 'COMMISSION', 'OTHER_EARNING', 'RECOVERY', 'OTHER_DEDUCTION');

-- CreateEnum
CREATE TYPE "SalaryArrearStatus" AS ENUM ('PENDING', 'INCLUDED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalaryHoldStatus" AS ENUM ('HELD', 'RELEASED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AccountingCostCenterMode" AS ENUM ('NONE', 'DEPARTMENT', 'BRANCH');

-- CreateEnum
CREATE TYPE "JobRequisitionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'FILLED');

-- CreateEnum
CREATE TYPE "JobOpeningStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "PipelineStageCategory" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('CAREERS_PAGE', 'REFERRAL', 'AGENCY', 'JOB_BOARD', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('ACTIVE', 'REJECTED', 'WITHDRAWN', 'HIRED');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('IN_PERSON', 'VIDEO', 'PHONE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "InterviewRecommendation" AS ENUM ('STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE');

-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PreOnboardingStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'REVOKED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SALARY_HELD';
ALTER TYPE "NotificationType" ADD VALUE 'SALARY_RELEASED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUISITION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUISITION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPLICATION_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_FEEDBACK_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'PRE_ONBOARDING_SUBMITTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowEntityType" ADD VALUE 'JOB_REQUISITION';
ALTER TYPE "WorkflowEntityType" ADD VALUE 'OFFER';

-- DropIndex
DROP INDEX "payroll_runs_tenantId_month_year_key";

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "includeSalary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsRecompute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offCycleReason" VARCHAR(500),
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "runType" "PayrollRunType" NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "scopeEmployeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payslips" ADD COLUMN     "arrearsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nonRecurringTaxable" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nonTaxableEarnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reimbursementAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN     "payrollRunId" TEXT;

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "payrollRunId" TEXT;

-- CreateTable
CREATE TABLE "payroll_one_time_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "OneTimePaymentKind" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_one_time_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_arrears" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeSalaryId" TEXT NOT NULL,
    "forMonth" INTEGER NOT NULL,
    "forYear" INTEGER NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "originalPayslipId" TEXT NOT NULL,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "revisedAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "pfWagesDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "status" "SalaryArrearStatus" NOT NULL DEFAULT 'PENDING',
    "payrollRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_arrears_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_holds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "SalaryHoldStatus" NOT NULL DEFAULT 'HELD',
    "heldAmount" DECIMAL(12,2),
    "releaseRunId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" VARCHAR(500),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reimburseExpensesViaPayroll" BOOLEAN NOT NULL DEFAULT false,
    "autoArrears" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_gl_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "componentKey" VARCHAR(100) NOT NULL,
    "glCode" VARCHAR(50) NOT NULL,
    "glName" VARCHAR(150) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_gl_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_accounting_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "suspenseGlCode" VARCHAR(50),
    "suspenseGlName" VARCHAR(150),
    "costCenterMode" "AccountingCostCenterMode" NOT NULL DEFAULT 'NONE',
    "tallyCompanyName" VARCHAR(150),
    "tallyVoucherType" VARCHAR(50) NOT NULL DEFAULT 'Journal',
    "narrationTemplate" VARCHAR(200) NOT NULL DEFAULT 'Salary for {{month}} {{year}}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_accounting_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "careersPageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "careersIntro" TEXT,
    "offerExpiryDays" INTEGER NOT NULL DEFAULT 7,
    "preOnboardingExpiryDays" INTEGER NOT NULL DEFAULT 14,
    "preOnboardingDocuments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruitment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_requisitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "hiringManagerId" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "budgetMin" DECIMAL(14,2),
    "budgetMax" DECIMAL(14,2),
    "justification" TEXT,
    "status" "JobRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "requesterEmployeeId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decisionNote" VARCHAR(1000),
    "filledCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_openings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requisitionId" TEXT,
    "title" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "location" VARCHAR(150),
    "departmentId" TEXT,
    "designationId" TEXT,
    "branchId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "experienceMin" INTEGER,
    "experienceMax" INTEGER,
    "salaryMin" DECIMAL(14,2),
    "salaryMax" DECIMAL(14,2),
    "showSalary" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "positions" INTEGER NOT NULL DEFAULT 1,
    "hiringManagerId" TEXT,
    "status" "JobOpeningStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "category" "PipelineStageCategory" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30),
    "currentCompany" VARCHAR(150),
    "currentTitle" VARCHAR(150),
    "totalExperienceYears" DECIMAL(4,1),
    "currentCtc" DECIMAL(14,2),
    "expectedCtc" DECIMAL(14,2),
    "noticePeriodDays" INTEGER,
    "location" VARCHAR(150),
    "linkedinUrl" VARCHAR(300),
    "source" "CandidateSource" NOT NULL DEFAULT 'DIRECT',
    "referredByEmployeeId" TEXT,
    "resumeUploadId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "CandidateSource" NOT NULL DEFAULT 'DIRECT',
    "resumeUploadId" TEXT,
    "coverLetter" TEXT,
    "rejectionReason" VARCHAR(1000),
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application_stage_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "movedById" TEXT,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "roundName" VARCHAR(100) NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "mode" "InterviewMode" NOT NULL DEFAULT 'VIDEO',
    "location" VARCHAR(300),
    "meetingLink" VARCHAR(500),
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_panelists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_panelists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "interviewerEmployeeId" TEXT NOT NULL,
    "overallRating" INTEGER NOT NULL,
    "recommendation" "InterviewRecommendation" NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '[]',
    "strengths" TEXT,
    "concerns" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "designationId" TEXT,
    "departmentId" TEXT,
    "branchId" TEXT,
    "reportingManagerId" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "annualCtc" DECIMAL(14,2) NOT NULL,
    "monthlyBasePay" DECIMAL(12,2),
    "salaryStructureId" TEXT,
    "joiningDate" DATE NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" "JobOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "tokenHash" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "acceptedName" VARCHAR(200),
    "declineReason" VARCHAR(1000),
    "respondedIp" VARCHAR(64),
    "respondedUserAgent" VARCHAR(300),
    "decisionNote" VARCHAR(1000),
    "createdById" TEXT NOT NULL,
    "employeeId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_onboarding_invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "offerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "PreOnboardingStatus" NOT NULL DEFAULT 'INVITED',
    "requiredDocuments" JSONB NOT NULL DEFAULT '[]',
    "personalDetails" JSONB,
    "submittedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_onboarding_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_onboarding_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "documentKey" VARCHAR(50) NOT NULL,
    "employeeDocumentId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_one_time_payments_tenantId_payrollRunId_idx" ON "payroll_one_time_payments"("tenantId", "payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_one_time_payments_employeeId_idx" ON "payroll_one_time_payments"("employeeId");

-- CreateIndex
CREATE INDEX "salary_arrears_tenantId_status_idx" ON "salary_arrears"("tenantId", "status");

-- CreateIndex
CREATE INDEX "salary_arrears_employeeId_idx" ON "salary_arrears"("employeeId");

-- CreateIndex
CREATE INDEX "salary_arrears_payrollRunId_idx" ON "salary_arrears"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_arrears_employeeSalaryId_forMonth_forYear_key" ON "salary_arrears"("employeeSalaryId", "forMonth", "forYear");

-- CreateIndex
CREATE INDEX "salary_holds_tenantId_status_idx" ON "salary_holds"("tenantId", "status");

-- CreateIndex
CREATE INDEX "salary_holds_releaseRunId_idx" ON "salary_holds"("releaseRunId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_holds_payrollRunId_employeeId_key" ON "salary_holds"("payrollRunId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settings_tenantId_key" ON "payroll_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_gl_mappings_tenantId_componentKey_key" ON "payroll_gl_mappings"("tenantId", "componentKey");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_accounting_configs_tenantId_key" ON "payroll_accounting_configs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_settings_tenantId_key" ON "recruitment_settings"("tenantId");

-- CreateIndex
CREATE INDEX "job_requisitions_tenantId_status_idx" ON "job_requisitions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_openings_tenantId_status_idx" ON "job_openings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_openings_requisitionId_idx" ON "job_openings"("requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_tenantId_slug_key" ON "job_openings"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "pipeline_stages_tenantId_sortOrder_idx" ON "pipeline_stages"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenantId_name_key" ON "pipeline_stages"("tenantId", "name");

-- CreateIndex
CREATE INDEX "candidates_tenantId_idx" ON "candidates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_tenantId_email_key" ON "candidates"("tenantId", "email");

-- CreateIndex
CREATE INDEX "job_applications_tenantId_stageId_idx" ON "job_applications"("tenantId", "stageId");

-- CreateIndex
CREATE INDEX "job_applications_tenantId_status_idx" ON "job_applications"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_applications_candidateId_idx" ON "job_applications"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_jobOpeningId_candidateId_key" ON "job_applications"("jobOpeningId", "candidateId");

-- CreateIndex
CREATE INDEX "job_application_stage_events_applicationId_idx" ON "job_application_stage_events"("applicationId");

-- CreateIndex
CREATE INDEX "job_application_stage_events_tenantId_createdAt_idx" ON "job_application_stage_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "interviews_tenantId_scheduledStart_idx" ON "interviews"("tenantId", "scheduledStart");

-- CreateIndex
CREATE INDEX "interviews_applicationId_idx" ON "interviews"("applicationId");

-- CreateIndex
CREATE INDEX "interview_panelists_tenantId_employeeId_idx" ON "interview_panelists"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "interview_panelists_interviewId_employeeId_key" ON "interview_panelists"("interviewId", "employeeId");

-- CreateIndex
CREATE INDEX "interview_feedback_tenantId_idx" ON "interview_feedback"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "interview_feedback_interviewId_interviewerEmployeeId_key" ON "interview_feedback"("interviewId", "interviewerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_tokenHash_key" ON "job_offers"("tokenHash");

-- CreateIndex
CREATE INDEX "job_offers_tenantId_status_idx" ON "job_offers"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_offers_applicationId_idx" ON "job_offers"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "pre_onboarding_invites_offerId_key" ON "pre_onboarding_invites"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "pre_onboarding_invites_tokenHash_key" ON "pre_onboarding_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "pre_onboarding_invites_tenantId_status_idx" ON "pre_onboarding_invites"("tenantId", "status");

-- CreateIndex
CREATE INDEX "pre_onboarding_invites_employeeId_idx" ON "pre_onboarding_invites"("employeeId");

-- CreateIndex
CREATE INDEX "pre_onboarding_documents_tenantId_idx" ON "pre_onboarding_documents"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pre_onboarding_documents_inviteId_documentKey_key" ON "pre_onboarding_documents"("inviteId", "documentKey");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenantId_month_year_runType_sequence_key" ON "payroll_runs"("tenantId", "month", "year", "runType", "sequence");

-- CreateIndex
CREATE INDEX "expense_claims_payrollRunId_idx" ON "expense_claims"("payrollRunId");

-- CreateIndex
CREATE INDEX "settlements_payrollRunId_idx" ON "settlements"("payrollRunId");

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_one_time_payments" ADD CONSTRAINT "payroll_one_time_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_one_time_payments" ADD CONSTRAINT "payroll_one_time_payments_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_one_time_payments" ADD CONSTRAINT "payroll_one_time_payments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_arrears" ADD CONSTRAINT "salary_arrears_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_arrears" ADD CONSTRAINT "salary_arrears_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_arrears" ADD CONSTRAINT "salary_arrears_employeeSalaryId_fkey" FOREIGN KEY ("employeeSalaryId") REFERENCES "employee_salaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_arrears" ADD CONSTRAINT "salary_arrears_originalPayslipId_fkey" FOREIGN KEY ("originalPayslipId") REFERENCES "payslips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_arrears" ADD CONSTRAINT "salary_arrears_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_holds" ADD CONSTRAINT "salary_holds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_holds" ADD CONSTRAINT "salary_holds_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_holds" ADD CONSTRAINT "salary_holds_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_holds" ADD CONSTRAINT "salary_holds_releaseRunId_fkey" FOREIGN KEY ("releaseRunId") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_gl_mappings" ADD CONSTRAINT "payroll_gl_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_accounting_configs" ADD CONSTRAINT "payroll_accounting_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_settings" ADD CONSTRAINT "recruitment_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "job_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_referredByEmployeeId_fkey" FOREIGN KEY ("referredByEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_resumeUploadId_fkey" FOREIGN KEY ("resumeUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "job_openings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_resumeUploadId_fkey" FOREIGN KEY ("resumeUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_stage_events" ADD CONSTRAINT "job_application_stage_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_stage_events" ADD CONSTRAINT "job_application_stage_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_stage_events" ADD CONSTRAINT "job_application_stage_events_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_stage_events" ADD CONSTRAINT "job_application_stage_events_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interviewerEmployeeId_fkey" FOREIGN KEY ("interviewerEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "letter_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_onboarding_invites" ADD CONSTRAINT "pre_onboarding_invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_onboarding_invites" ADD CONSTRAINT "pre_onboarding_invites_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_onboarding_invites" ADD CONSTRAINT "pre_onboarding_invites_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "job_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_onboarding_documents" ADD CONSTRAINT "pre_onboarding_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_onboarding_documents" ADD CONSTRAINT "pre_onboarding_documents_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "pre_onboarding_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_onboarding_documents" ADD CONSTRAINT "pre_onboarding_documents_employeeDocumentId_fkey" FOREIGN KEY ("employeeDocumentId") REFERENCES "employee_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

