-- CreateEnum
CREATE TYPE "AttendanceRequestType" AS ENUM ('WFH', 'ON_DUTY');

-- CreateEnum
CREATE TYPE "AttendanceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RosterEntrySource" AS ENUM ('MANUAL', 'PATTERN');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'ON_DUTY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_REQUEST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_REQUEST_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowEntityType" ADD VALUE 'WFH_REQUEST';
ALTER TYPE "WorkflowEntityType" ADD VALUE 'ON_DUTY_REQUEST';
ALTER TYPE "WorkflowEntityType" ADD VALUE 'TIMESHEET';

-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "inIp" VARCHAR(45),
ADD COLUMN     "inSelfieUploadId" TEXT,
ADD COLUMN     "outIp" VARCHAR(45),
ADD COLUMN     "outSelfieUploadId" TEXT;

-- AlterTable
ALTER TABLE "attendance_policies" ADD COLUMN     "allowedIpRanges" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ipRestrictionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selfieRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "attendance_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "AttendanceRequestType" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "location" VARCHAR(200),
    "status" "AttendanceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "approverNote" VARCHAR(500),
    "decidedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_rotation_patterns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "cycleLength" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_rotation_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_rotation_pattern_days" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "shiftId" TEXT,

    CONSTRAINT "shift_rotation_pattern_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shiftId" TEXT,
    "isOff" BOOLEAN NOT NULL DEFAULT false,
    "source" "RosterEntrySource" NOT NULL,
    "patternId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "clientName" VARCHAR(150),
    "description" VARCHAR(2000),
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE,
    "endDate" DATE,
    "managerEmployeeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" VARCHAR(50),
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "billable" BOOLEAN,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'OPEN',
    "estimateHours" DECIMAL(7,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "approverId" TEXT,
    "approverNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "hours" DECIMAL(5,2) NOT NULL,
    "billable" BOOLEAN NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_requests_tenantId_employeeId_fromDate_idx" ON "attendance_requests"("tenantId", "employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "attendance_requests_tenantId_status_idx" ON "attendance_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "shift_rotation_patterns_tenantId_idx" ON "shift_rotation_patterns"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_rotation_pattern_days_patternId_dayIndex_key" ON "shift_rotation_pattern_days"("patternId", "dayIndex");

-- CreateIndex
CREATE INDEX "roster_entries_tenantId_date_idx" ON "roster_entries"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_tenantId_employeeId_date_key" ON "roster_entries"("tenantId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "projects_tenantId_status_idx" ON "projects"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenantId_code_key" ON "projects"("tenantId", "code");

-- CreateIndex
CREATE INDEX "project_members_tenantId_employeeId_idx" ON "project_members"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_employeeId_key" ON "project_members"("projectId", "employeeId");

-- CreateIndex
CREATE INDEX "project_tasks_projectId_idx" ON "project_tasks"("projectId");

-- CreateIndex
CREATE INDEX "timesheets_tenantId_status_idx" ON "timesheets"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_tenantId_employeeId_weekStart_key" ON "timesheets"("tenantId", "employeeId", "weekStart");

-- CreateIndex
CREATE INDEX "timesheet_entries_timesheetId_idx" ON "timesheet_entries"("timesheetId");

-- CreateIndex
CREATE INDEX "timesheet_entries_tenantId_projectId_date_idx" ON "timesheet_entries"("tenantId", "projectId", "date");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_inSelfieUploadId_fkey" FOREIGN KEY ("inSelfieUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_outSelfieUploadId_fkey" FOREIGN KEY ("outSelfieUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_requests" ADD CONSTRAINT "attendance_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_requests" ADD CONSTRAINT "attendance_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_rotation_patterns" ADD CONSTRAINT "shift_rotation_patterns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_rotation_pattern_days" ADD CONSTRAINT "shift_rotation_pattern_days_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "shift_rotation_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_rotation_pattern_days" ADD CONSTRAINT "shift_rotation_pattern_days_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "shift_rotation_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

