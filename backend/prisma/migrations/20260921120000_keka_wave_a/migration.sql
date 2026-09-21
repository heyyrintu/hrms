-- Keka gap closure, wave A.
-- Spec: docs/superpowers/specs/2026-09-21-keka-gap-wave-a-design.md
--
-- Everything here is additive. Existing rows keep their behaviour: the new
-- attendance columns default to "not late / not auto-marked", and no policy
-- row exists until HR opens the settings page, so no cron marks anyone absent.

-- ---- Enums -----------------------------------------------------------------

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LOAN_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LOAN_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAVE_CARRIED_FORWARD';

CREATE TYPE "CarryForwardRunStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "LoanType" AS ENUM ('LOAN', 'SALARY_ADVANCE');
CREATE TYPE "LoanStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "RepaymentSource" AS ENUM ('PAYROLL', 'MANUAL', 'SETTLEMENT');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_EMPLOYEE', 'RESOLVED', 'CLOSED');

-- ---- Workstream 4: attendance record columns --------------------------------

ALTER TABLE "attendance_records"
  ADD COLUMN "isLate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lateByMinutes" INTEGER,
  ADD COLUMN "autoMarked" BOOLEAN NOT NULL DEFAULT false;

-- ---- Workstream 1: password reset tokens ------------------------------------

CREATE TABLE "password_reset_tokens" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
CREATE INDEX "password_reset_tokens_tokenHash_idx" ON "password_reset_tokens"("tokenHash");
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Workstream 3: leave carry-forward runs ---------------------------------

CREATE TABLE "leave_carry_forward_runs" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "fromYear"       INTEGER NOT NULL,
  "toYear"         INTEGER NOT NULL,
  "triggerType"    "AccrualTriggerType" NOT NULL DEFAULT 'CRON_JOB',
  "status"         "CarryForwardRunStatus" NOT NULL DEFAULT 'PENDING',
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount"    INTEGER NOT NULL DEFAULT 0,
  "triggeredById"  TEXT,
  "errorLog"       JSONB,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  CONSTRAINT "leave_carry_forward_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "leave_carry_forward_runs_tenantId_fromYear_key" ON "leave_carry_forward_runs"("tenantId", "fromYear");
CREATE INDEX "leave_carry_forward_runs_tenantId_idx" ON "leave_carry_forward_runs"("tenantId");
ALTER TABLE "leave_carry_forward_runs"
  ADD CONSTRAINT "leave_carry_forward_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Workstream 4: attendance policy ----------------------------------------

CREATE TABLE "attendance_policies" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "defaultShiftStart"   TEXT NOT NULL DEFAULT '09:00',
  "defaultGraceMinutes" INTEGER NOT NULL DEFAULT 15,
  "lateMarksPerHalfDay" INTEGER,
  "autoMarkAbsent"      BOOLEAN NOT NULL DEFAULT false,
  "absentIsLop"         BOOLEAN NOT NULL DEFAULT true,
  "minHalfDayMinutes"   INTEGER NOT NULL DEFAULT 240,
  "minFullDayMinutes"   INTEGER NOT NULL DEFAULT 480,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_policies_tenantId_key" ON "attendance_policies"("tenantId");
ALTER TABLE "attendance_policies"
  ADD CONSTRAINT "attendance_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Workstream 5: loans ----------------------------------------------------

CREATE TABLE "employee_loans" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "employeeId"        TEXT NOT NULL,
  "type"              "LoanType" NOT NULL DEFAULT 'LOAN',
  "principal"         DECIMAL(12,2) NOT NULL,
  "interestRate"      DECIMAL(5,2) NOT NULL DEFAULT 0,
  "tenureMonths"      INTEGER NOT NULL,
  "emiAmount"         DECIMAL(12,2) NOT NULL,
  "totalPayable"      DECIMAL(12,2) NOT NULL,
  "outstandingAmount" DECIMAL(12,2) NOT NULL,
  "startMonth"        INTEGER NOT NULL,
  "startYear"         INTEGER NOT NULL,
  "purpose"           TEXT,
  "status"            "LoanStatus" NOT NULL DEFAULT 'REQUESTED',
  "approvedById"      TEXT,
  "approvedAt"        TIMESTAMP(3),
  "rejectionReason"   TEXT,
  "disbursedAt"       TIMESTAMP(3),
  "closedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_loans_tenantId_idx" ON "employee_loans"("tenantId");
CREATE INDEX "employee_loans_employeeId_idx" ON "employee_loans"("employeeId");
CREATE INDEX "employee_loans_status_idx" ON "employee_loans"("status");
ALTER TABLE "employee_loans"
  ADD CONSTRAINT "employee_loans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loan_repayments" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "loanId"    TEXT NOT NULL,
  "month"     INTEGER NOT NULL,
  "year"      INTEGER NOT NULL,
  "amount"    DECIMAL(12,2) NOT NULL,
  "source"    "RepaymentSource" NOT NULL,
  "payslipId" TEXT,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "loan_repayments_loanId_month_year_source_key" ON "loan_repayments"("loanId", "month", "year", "source");
CREATE INDEX "loan_repayments_tenantId_idx" ON "loan_repayments"("tenantId");
ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "employee_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Workstream 6: helpdesk -------------------------------------------------

CREATE TABLE "hr_ticket_categories" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "description" TEXT,
  "slaHours"    INTEGER NOT NULL DEFAULT 48,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_ticket_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_ticket_categories_tenantId_code_key" ON "hr_ticket_categories"("tenantId", "code");
ALTER TABLE "hr_ticket_categories"
  ADD CONSTRAINT "hr_ticket_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "hr_tickets" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "ticketNumber" INTEGER NOT NULL,
  "employeeId"   TEXT NOT NULL,
  "categoryId"   TEXT NOT NULL,
  "subject"      TEXT NOT NULL,
  "description"  TEXT NOT NULL,
  "priority"     "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
  "status"       "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "assignedToId" TEXT,
  "slaDeadline"  TIMESTAMP(3) NOT NULL,
  "resolvedAt"   TIMESTAMP(3),
  "closedAt"     TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_tickets_tenantId_ticketNumber_key" ON "hr_tickets"("tenantId", "ticketNumber");
CREATE INDEX "hr_tickets_tenantId_status_idx" ON "hr_tickets"("tenantId", "status");
CREATE INDEX "hr_tickets_employeeId_idx" ON "hr_tickets"("employeeId");
CREATE INDEX "hr_tickets_assignedToId_idx" ON "hr_tickets"("assignedToId");
ALTER TABLE "hr_tickets"
  ADD CONSTRAINT "hr_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_tickets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "hr_ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "hr_ticket_comments" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "ticketId"   TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "isInternal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_ticket_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_ticket_comments_ticketId_idx" ON "hr_ticket_comments"("ticketId");
ALTER TABLE "hr_ticket_comments"
  ADD CONSTRAINT "hr_ticket_comments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_ticket_comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "hr_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_ticket_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
