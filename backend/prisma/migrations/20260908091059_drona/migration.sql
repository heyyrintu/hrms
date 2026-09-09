/*
  Warnings:

  - You are about to drop the column `designation` on the `employees` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "HalfDayPeriod" AS ENUM ('FIRST_HALF', 'SECOND_HALF');

-- CreateEnum
CREATE TYPE "AccrualTriggerType" AS ENUM ('CRON_JOB', 'MANUAL_ADMIN', 'MANUAL_SYSTEM');

-- CreateEnum
CREATE TYPE "AccrualStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('NATIONAL', 'REGIONAL', 'COMPANY', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'EMPLOYMENT', 'CONTRACT', 'CERTIFICATE', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_BALANCE_UPDATED', 'OT_APPROVED', 'OT_REJECTED', 'CHANGE_REQUEST_APPROVED', 'CHANGE_REQUEST_REJECTED', 'DOCUMENT_VERIFIED', 'SHIFT_ASSIGNED', 'ANNOUNCEMENT', 'EXPENSE_APPROVED', 'EXPENSE_REJECTED', 'EXPENSE_REIMBURSED', 'ONBOARDING_TASK_ASSIGNED', 'ONBOARDING_COMPLETED', 'REVIEW_CYCLE_LAUNCHED', 'REVIEW_SUBMITTED', 'REVIEW_COMPLETED', 'ATTENDANCE_REGULARIZATION_APPROVED', 'ATTENDANCE_REGULARIZATION_REJECTED', 'COMP_OFF_APPROVED', 'COMP_OFF_REJECTED', 'DOCUMENT_EXPIRING', 'FEEDBACK_RECEIVED', 'PIP_CREATED', 'PIP_UPDATED', 'LETTER_GENERATED', 'WEBHOOK_DELIVERY_FAILED', 'GENERAL');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPUTED', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "ExpenseClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED');

-- CreateEnum
CREATE TYPE "OnboardingType" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "OnboardingProcessStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OnboardingTaskCategory" AS ENUM ('IT_SETUP', 'HR_PAPERWORK', 'TRAINING', 'COMPLIANCE', 'FACILITIES', 'GENERAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN');

-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PerformanceReviewStatus" AS ENUM ('PENDING', 'SELF_REVIEW', 'MANAGER_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RegularizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'AVAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LetterType" AS ENUM ('OFFER_LETTER', 'APPOINTMENT_LETTER', 'INCREMENT_LETTER', 'CONFIRMATION_LETTER', 'RELIEVING_LETTER', 'EXPERIENCE_LETTER', 'TRANSFER_LETTER', 'PROMOTION_LETTER', 'WARNING_LETTER', 'TERMINATION_LETTER', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('POSITIVE', 'CONSTRUCTIVE', 'GENERAL');

-- CreateEnum
CREATE TYPE "FeedbackVisibility" AS ENUM ('PRIVATE', 'VISIBLE_TO_MANAGER', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PIPStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'EXTENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "WebhookLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "SeparationType" AS ENUM ('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'END_OF_CONTRACT', 'MUTUAL_SEPARATION', 'ABSCONDING');

-- CreateEnum
CREATE TYPE "SeparationStatus" AS ENUM ('INITIATED', 'NOTICE_PERIOD', 'CLEARANCE_PENDING', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AttendanceSource" ADD VALUE 'BIOMETRIC';

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "clockInLatitude" DOUBLE PRECISION,
ADD COLUMN     "clockInLongitude" DOUBLE PRECISION,
ADD COLUMN     "clockOutLatitude" DOUBLE PRECISION,
ADD COLUMN     "clockOutLongitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "designation",
ADD COLUMN     "aadhaarNumber" TEXT,
ADD COLUMN     "biometricUserId" TEXT,
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "currentAddress" TEXT,
ADD COLUMN     "currentCity" TEXT,
ADD COLUMN     "currentCountry" TEXT,
ADD COLUMN     "currentState" TEXT,
ADD COLUMN     "currentZipCode" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "designationId" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactNumber" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT,
ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "mobileNumber" TEXT,
ADD COLUMN     "monthlySalary" DECIMAL(12,2),
ADD COLUMN     "permanentAddress" TEXT,
ADD COLUMN     "permanentCity" TEXT,
ADD COLUMN     "permanentCountry" TEXT,
ADD COLUMN     "permanentState" TEXT,
ADD COLUMN     "permanentZipCode" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "salutation" TEXT,
ADD COLUMN     "workEmail" TEXT;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "halfDayPeriod" "HalfDayPeriod",
ADD COLUMN     "isHalfDay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "addressLine1" VARCHAR(255),
ADD COLUMN     "addressLine2" VARCHAR(255),
ADD COLUMN     "cin" VARCHAR(21),
ADD COLUMN     "city" VARCHAR(100),
ADD COLUMN     "companyType" VARCHAR(50),
ADD COLUMN     "country" VARCHAR(100),
ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
ADD COLUMN     "description" VARCHAR(2000),
ADD COLUMN     "email" VARCHAR(100),
ADD COLUMN     "esiRegistrationNumber" VARCHAR(20),
ADD COLUMN     "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "gstin" VARCHAR(15),
ADD COLUMN     "industry" VARCHAR(100),
ADD COLUMN     "leaveYearStartMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "legalName" VARCHAR(200),
ADD COLUMN     "logoUrl" VARCHAR(500),
ADD COLUMN     "officeLatitude" DOUBLE PRECISION,
ADD COLUMN     "officeLongitude" DOUBLE PRECISION,
ADD COLUMN     "officeRadiusMeters" INTEGER,
ADD COLUMN     "pan" VARCHAR(10),
ADD COLUMN     "payrollFrequency" VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "payrollProcessingDay" INTEGER NOT NULL DEFAULT 28,
ADD COLUMN     "pfRegistrationNumber" VARCHAR(30),
ADD COLUMN     "phone" VARCHAR(20),
ADD COLUMN     "pinCode" VARCHAR(10),
ADD COLUMN     "standardWorkHoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8.0,
ADD COLUMN     "state" VARCHAR(100),
ADD COLUMN     "tan" VARCHAR(10),
ADD COLUMN     "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "website" VARCHAR(255),
ADD COLUMN     "workDaysPerWeek" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "designations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HEAD_OFFICE',
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_devices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'ESSL_ICLOCK',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biometric_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_attendance_logs" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceUserId" TEXT NOT NULL,
    "punchTime" TIMESTAMP(3) NOT NULL,
    "punchType" INTEGER NOT NULL,
    "verifyType" INTEGER NOT NULL,
    "rawData" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "employeeId" TEXT,
    "attendanceId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_attendance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_accrual_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "monthlyAccrualDays" DECIMAL(5,2) NOT NULL,
    "maxBalanceCap" DECIMAL(5,2),
    "applyCapOnAccrual" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_accrual_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_accrual_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "triggerType" "AccrualTriggerType" NOT NULL DEFAULT 'CRON_JOB',
    "triggeredBy" TEXT,
    "status" "AccrualStatus" NOT NULL DEFAULT 'PENDING',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_accrual_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_accrual_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accrualRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "leaveBalanceId" TEXT NOT NULL,
    "accrualDays" DECIMAL(5,2) NOT NULL,
    "balanceBefore" DECIMAL(5,2) NOT NULL,
    "balanceAfter" DECIMAL(5,2) NOT NULL,
    "capApplied" BOOLEAN NOT NULL DEFAULT false,
    "capAmount" DECIMAL(5,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_accrual_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "HolidayType" NOT NULL DEFAULT 'COMPANY',
    "region" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "standardWorkMinutes" INTEGER NOT NULL DEFAULT 480,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "documentDate" DATE,
    "expiryDate" DATE,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_change_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "components" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "basePay" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "processedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workingDays" INTEGER NOT NULL DEFAULT 0,
    "presentDays" INTEGER NOT NULL DEFAULT 0,
    "leaveDays" INTEGER NOT NULL DEFAULT 0,
    "lopDays" INTEGER NOT NULL DEFAULT 0,
    "otHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "basePay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "earnings" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "maxAmount" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "receiptId" TEXT,
    "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "approverId" TEXT,
    "approverNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reimbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OnboardingType" NOT NULL DEFAULT 'ONBOARDING',
    "description" TEXT,
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_processes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "type" "OnboardingType" NOT NULL DEFAULT 'ONBOARDING',
    "status" "OnboardingProcessStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startDate" DATE,
    "targetDate" DATE,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "OnboardingTaskCategory" NOT NULL DEFAULT 'GENERAL',
    "assigneeId" TEXT,
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cycles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "status" "PerformanceReviewStatus" NOT NULL DEFAULT 'PENDING',
    "selfRating" INTEGER,
    "selfComments" TEXT,
    "managerRating" INTEGER,
    "managerComments" TEXT,
    "overallRating" INTEGER,
    "selfSubmittedAt" TIMESTAMP(3),
    "managerSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" DATE NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "weight" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_regularizations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "originalClockIn" TIMESTAMP(3),
    "originalClockOut" TIMESTAMP(3),
    "requestedClockIn" TIMESTAMP(3) NOT NULL,
    "requestedClockOut" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RegularizationStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "approverNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_regularizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_off_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workedDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "expiryDate" DATE,
    "earnedDays" DECIMAL(3,1) NOT NULL DEFAULT 1.0,
    "status" "CompOffStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "approverNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_off_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LetterType" NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letter_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letters_generated" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letters_generated_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "visibility" "FeedbackVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PIPStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "improvement_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_plan_goals" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "improvement_plan_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookLogStatus" NOT NULL,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "SeparationType" NOT NULL,
    "status" "SeparationStatus" NOT NULL DEFAULT 'INITIATED',
    "reason" TEXT,
    "initiatedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWorkingDate" TIMESTAMP(3),
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "isNoticePeriodWaived" BOOLEAN NOT NULL DEFAULT false,
    "exitInterviewDone" BOOLEAN NOT NULL DEFAULT false,
    "exitInterviewNotes" TEXT,
    "clearanceNotes" TEXT,
    "processedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "separations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "designations_tenantId_idx" ON "designations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "designations_tenantId_name_key" ON "designations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "branches_tenantId_idx" ON "branches"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_name_key" ON "branches"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_devices_serialNumber_key" ON "biometric_devices"("serialNumber");

-- CreateIndex
CREATE INDEX "biometric_devices_tenantId_idx" ON "biometric_devices"("tenantId");

-- CreateIndex
CREATE INDEX "device_attendance_logs_deviceId_idx" ON "device_attendance_logs"("deviceId");

-- CreateIndex
CREATE INDEX "device_attendance_logs_deviceUserId_punchTime_idx" ON "device_attendance_logs"("deviceUserId", "punchTime");

-- CreateIndex
CREATE INDEX "device_attendance_logs_processed_idx" ON "device_attendance_logs"("processed");

-- CreateIndex
CREATE INDEX "leave_accrual_rules_tenantId_idx" ON "leave_accrual_rules"("tenantId");

-- CreateIndex
CREATE INDEX "leave_accrual_rules_leaveTypeId_idx" ON "leave_accrual_rules"("leaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_accrual_rules_tenantId_leaveTypeId_key" ON "leave_accrual_rules"("tenantId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "leave_accrual_runs_tenantId_idx" ON "leave_accrual_runs"("tenantId");

-- CreateIndex
CREATE INDEX "leave_accrual_runs_status_idx" ON "leave_accrual_runs"("status");

-- CreateIndex
CREATE INDEX "leave_accrual_runs_fiscalYear_idx" ON "leave_accrual_runs"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "leave_accrual_runs_tenantId_month_year_key" ON "leave_accrual_runs"("tenantId", "month", "year");

-- CreateIndex
CREATE INDEX "leave_accrual_entries_tenantId_idx" ON "leave_accrual_entries"("tenantId");

-- CreateIndex
CREATE INDEX "leave_accrual_entries_accrualRunId_idx" ON "leave_accrual_entries"("accrualRunId");

-- CreateIndex
CREATE INDEX "leave_accrual_entries_employeeId_idx" ON "leave_accrual_entries"("employeeId");

-- CreateIndex
CREATE INDEX "leave_accrual_entries_leaveTypeId_idx" ON "leave_accrual_entries"("leaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_accrual_entries_accrualRunId_employeeId_leaveTypeId_key" ON "leave_accrual_entries"("accrualRunId", "employeeId", "leaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_key_key" ON "uploads"("key");

-- CreateIndex
CREATE INDEX "uploads_tenantId_idx" ON "uploads"("tenantId");

-- CreateIndex
CREATE INDEX "uploads_entityType_entityId_idx" ON "uploads"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "holidays_tenantId_idx" ON "holidays"("tenantId");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_tenantId_date_name_key" ON "holidays"("tenantId", "date", "name");

-- CreateIndex
CREATE INDEX "shifts_tenantId_idx" ON "shifts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenantId_code_key" ON "shifts"("tenantId", "code");

-- CreateIndex
CREATE INDEX "shift_assignments_tenantId_idx" ON "shift_assignments"("tenantId");

-- CreateIndex
CREATE INDEX "shift_assignments_employeeId_idx" ON "shift_assignments"("employeeId");

-- CreateIndex
CREATE INDEX "shift_assignments_shiftId_idx" ON "shift_assignments"("shiftId");

-- CreateIndex
CREATE INDEX "employee_documents_tenantId_idx" ON "employee_documents"("tenantId");

-- CreateIndex
CREATE INDEX "employee_documents_employeeId_idx" ON "employee_documents"("employeeId");

-- CreateIndex
CREATE INDEX "employee_documents_category_idx" ON "employee_documents"("category");

-- CreateIndex
CREATE INDEX "employee_change_requests_tenantId_idx" ON "employee_change_requests"("tenantId");

-- CreateIndex
CREATE INDEX "employee_change_requests_employeeId_idx" ON "employee_change_requests"("employeeId");

-- CreateIndex
CREATE INDEX "employee_change_requests_status_idx" ON "employee_change_requests"("status");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "announcements_tenantId_idx" ON "announcements"("tenantId");

-- CreateIndex
CREATE INDEX "announcements_tenantId_isPublished_idx" ON "announcements"("tenantId", "isPublished");

-- CreateIndex
CREATE INDEX "salary_structures_tenantId_idx" ON "salary_structures"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_tenantId_name_key" ON "salary_structures"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_salaries_tenantId_idx" ON "employee_salaries"("tenantId");

-- CreateIndex
CREATE INDEX "employee_salaries_employeeId_idx" ON "employee_salaries"("employeeId");

-- CreateIndex
CREATE INDEX "employee_salaries_salaryStructureId_idx" ON "employee_salaries"("salaryStructureId");

-- CreateIndex
CREATE INDEX "payroll_runs_tenantId_idx" ON "payroll_runs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenantId_month_year_key" ON "payroll_runs"("tenantId", "month", "year");

-- CreateIndex
CREATE INDEX "payslips_tenantId_idx" ON "payslips"("tenantId");

-- CreateIndex
CREATE INDEX "payslips_payrollRunId_idx" ON "payslips"("payrollRunId");

-- CreateIndex
CREATE INDEX "payslips_employeeId_idx" ON "payslips"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payrollRunId_employeeId_key" ON "payslips"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "expense_categories_tenantId_idx" ON "expense_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenantId_code_key" ON "expense_categories"("tenantId", "code");

-- CreateIndex
CREATE INDEX "expense_claims_tenantId_idx" ON "expense_claims"("tenantId");

-- CreateIndex
CREATE INDEX "expense_claims_employeeId_idx" ON "expense_claims"("employeeId");

-- CreateIndex
CREATE INDEX "expense_claims_status_idx" ON "expense_claims"("status");

-- CreateIndex
CREATE INDEX "onboarding_templates_tenantId_idx" ON "onboarding_templates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_tenantId_name_key" ON "onboarding_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "onboarding_processes_tenantId_idx" ON "onboarding_processes"("tenantId");

-- CreateIndex
CREATE INDEX "onboarding_processes_employeeId_idx" ON "onboarding_processes"("employeeId");

-- CreateIndex
CREATE INDEX "onboarding_processes_status_idx" ON "onboarding_processes"("status");

-- CreateIndex
CREATE INDEX "onboarding_tasks_tenantId_idx" ON "onboarding_tasks"("tenantId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_processId_idx" ON "onboarding_tasks"("processId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_assigneeId_idx" ON "onboarding_tasks"("assigneeId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_status_idx" ON "onboarding_tasks"("status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "review_cycles_tenantId_idx" ON "review_cycles"("tenantId");

-- CreateIndex
CREATE INDEX "review_cycles_status_idx" ON "review_cycles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "review_cycles_tenantId_name_key" ON "review_cycles"("tenantId", "name");

-- CreateIndex
CREATE INDEX "performance_reviews_tenantId_idx" ON "performance_reviews"("tenantId");

-- CreateIndex
CREATE INDEX "performance_reviews_cycleId_idx" ON "performance_reviews"("cycleId");

-- CreateIndex
CREATE INDEX "performance_reviews_employeeId_idx" ON "performance_reviews"("employeeId");

-- CreateIndex
CREATE INDEX "performance_reviews_reviewerId_idx" ON "performance_reviews"("reviewerId");

-- CreateIndex
CREATE INDEX "performance_reviews_status_idx" ON "performance_reviews"("status");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_cycleId_employeeId_key" ON "performance_reviews"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "goals_tenantId_idx" ON "goals"("tenantId");

-- CreateIndex
CREATE INDEX "goals_reviewId_idx" ON "goals"("reviewId");

-- CreateIndex
CREATE INDEX "goals_employeeId_idx" ON "goals"("employeeId");

-- CreateIndex
CREATE INDEX "goals_status_idx" ON "goals"("status");

-- CreateIndex
CREATE INDEX "attendance_regularizations_tenantId_idx" ON "attendance_regularizations"("tenantId");

-- CreateIndex
CREATE INDEX "attendance_regularizations_employeeId_idx" ON "attendance_regularizations"("employeeId");

-- CreateIndex
CREATE INDEX "attendance_regularizations_status_idx" ON "attendance_regularizations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_regularizations_tenantId_employeeId_date_key" ON "attendance_regularizations"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "comp_off_requests_tenantId_idx" ON "comp_off_requests"("tenantId");

-- CreateIndex
CREATE INDEX "comp_off_requests_employeeId_idx" ON "comp_off_requests"("employeeId");

-- CreateIndex
CREATE INDEX "comp_off_requests_status_idx" ON "comp_off_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "comp_off_requests_tenantId_employeeId_workedDate_key" ON "comp_off_requests"("tenantId", "employeeId", "workedDate");

-- CreateIndex
CREATE INDEX "letter_templates_tenantId_idx" ON "letter_templates"("tenantId");

-- CreateIndex
CREATE INDEX "letter_templates_type_idx" ON "letter_templates"("type");

-- CreateIndex
CREATE INDEX "letters_generated_tenantId_idx" ON "letters_generated"("tenantId");

-- CreateIndex
CREATE INDEX "letters_generated_employeeId_idx" ON "letters_generated"("employeeId");

-- CreateIndex
CREATE INDEX "feedbacks_tenantId_idx" ON "feedbacks"("tenantId");

-- CreateIndex
CREATE INDEX "feedbacks_receiverId_idx" ON "feedbacks"("receiverId");

-- CreateIndex
CREATE INDEX "feedbacks_senderId_idx" ON "feedbacks"("senderId");

-- CreateIndex
CREATE INDEX "improvement_plans_tenantId_idx" ON "improvement_plans"("tenantId");

-- CreateIndex
CREATE INDEX "improvement_plans_employeeId_idx" ON "improvement_plans"("employeeId");

-- CreateIndex
CREATE INDEX "improvement_plans_managerId_idx" ON "improvement_plans"("managerId");

-- CreateIndex
CREATE INDEX "improvement_plans_status_idx" ON "improvement_plans"("status");

-- CreateIndex
CREATE INDEX "improvement_plan_goals_planId_idx" ON "improvement_plan_goals"("planId");

-- CreateIndex
CREATE INDEX "webhooks_tenantId_idx" ON "webhooks"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_logs_tenantId_idx" ON "webhook_logs"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_logs_webhookId_idx" ON "webhook_logs"("webhookId");

-- CreateIndex
CREATE INDEX "webhook_logs_triggeredAt_idx" ON "webhook_logs"("triggeredAt");

-- CreateIndex
CREATE INDEX "separations_tenantId_idx" ON "separations"("tenantId");

-- CreateIndex
CREATE INDEX "separations_employeeId_idx" ON "separations"("employeeId");

-- CreateIndex
CREATE INDEX "separations_status_idx" ON "separations"("status");

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_devices" ADD CONSTRAINT "biometric_devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_attendance_logs" ADD CONSTRAINT "device_attendance_logs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "biometric_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_rules" ADD CONSTRAINT "leave_accrual_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_rules" ADD CONSTRAINT "leave_accrual_rules_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_runs" ADD CONSTRAINT "leave_accrual_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_entries" ADD CONSTRAINT "leave_accrual_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_entries" ADD CONSTRAINT "leave_accrual_entries_accrualRunId_fkey" FOREIGN KEY ("accrualRunId") REFERENCES "leave_accrual_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_entries" ADD CONSTRAINT "leave_accrual_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_entries" ADD CONSTRAINT "leave_accrual_entries_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_accrual_entries" ADD CONSTRAINT "leave_accrual_entries_leaveBalanceId_fkey" FOREIGN KEY ("leaveBalanceId") REFERENCES "leave_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "salary_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_processes" ADD CONSTRAINT "onboarding_processes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_processes" ADD CONSTRAINT "onboarding_processes_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_processes" ADD CONSTRAINT "onboarding_processes_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "onboarding_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_processId_fkey" FOREIGN KEY ("processId") REFERENCES "onboarding_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "performance_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_generated" ADD CONSTRAINT "letters_generated_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_generated" ADD CONSTRAINT "letters_generated_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "letter_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_generated" ADD CONSTRAINT "letters_generated_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plan_goals" ADD CONSTRAINT "improvement_plan_goals_planId_fkey" FOREIGN KEY ("planId") REFERENCES "improvement_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separations" ADD CONSTRAINT "separations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separations" ADD CONSTRAINT "separations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separations" ADD CONSTRAINT "separations_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
