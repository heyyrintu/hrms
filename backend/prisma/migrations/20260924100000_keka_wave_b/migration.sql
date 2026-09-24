-- CreateEnum
CREATE TYPE "WorkflowEntityType" AS ENUM ('LEAVE', 'EXPENSE', 'LOAN', 'COMP_OFF', 'REGULARIZATION', 'PAYROLL_RUN');

-- CreateEnum
CREATE TYPE "WorkflowApproverType" AS ENUM ('REPORTING_MANAGER', 'MANAGERS_MANAGER', 'HR_ADMIN', 'SPECIFIC_USER', 'ROLE');

-- CreateEnum
CREATE TYPE "ApprovalInstanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum

ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_STEP_APPROVED';

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "processedById" TEXT;

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "WorkflowEntityType" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "adminOverride" BOOLEAN NOT NULL DEFAULT true,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "approverType" "WorkflowApproverType" NOT NULL,
    "approverUserId" TEXT,
    "approverRole" "UserRole",
    "minAmount" DECIMAL(14,2),
    "minDays" DECIMAL(6,2),

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" "WorkflowEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "definitionId" TEXT,
    "status" "ApprovalInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "currentStepOrder" INTEGER NOT NULL DEFAULT 1,
    "round" INTEGER NOT NULL DEFAULT 1,
    "steps" JSONB NOT NULL,
    "adminOverride" BOOLEAN NOT NULL DEFAULT true,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT true,
    "requesterEmployeeId" TEXT,
    "requesterUserId" TEXT,
    "amount" DECIMAL(14,2),
    "days" DECIMAL(6,2),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "onBehalfOfUserId" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "delegatorUserId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "entityType" "WorkflowEntityType",
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_tenantId_entityType_key" ON "workflow_definitions"("tenantId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_definitionId_stepOrder_key" ON "workflow_steps"("definitionId", "stepOrder");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_status_idx" ON "approval_instances"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_entityType_entityId_key" ON "approval_instances"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "approval_actions_instanceId_idx" ON "approval_actions"("instanceId");

-- CreateIndex
CREATE INDEX "approval_delegations_tenantId_delegateUserId_idx" ON "approval_delegations"("tenantId", "delegateUserId");

-- CreateIndex
CREATE INDEX "approval_delegations_tenantId_delegatorUserId_idx" ON "approval_delegations"("tenantId", "delegatorUserId");

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: every request awaiting approval today gets a PENDING instance on
-- the built-in default chain, so nothing in flight is lost. Default chains:
-- reporting manager for leave / expense / comp-off / regularization, HR for
-- loans and payroll runs (payroll: maker-checker, allowSelfApproval false).
-- ---------------------------------------------------------------------------

INSERT INTO "approval_instances" ("id", "tenantId", "entityType", "entityId", "status", "currentStepOrder", "round", "steps", "adminOverride", "allowSelfApproval", "requesterEmployeeId", "requesterUserId", "amount", "days", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id")::uuid::text, r."tenantId", 'LEAVE'::"WorkflowEntityType", r."id", 'PENDING'::"ApprovalInstanceStatus", 1, 1,
       '[{"order":1,"name":"Reporting manager","approverType":"REPORTING_MANAGER","approverUserId":null,"approverRole":null}]'::jsonb,
       true, true, r."employeeId", (SELECT u."id" FROM "users" u WHERE u."employeeId" = r."employeeId" LIMIT 1), NULL, r."totalDays", r."createdAt", CURRENT_TIMESTAMP
FROM "leave_requests" r WHERE r."status" = 'PENDING';

INSERT INTO "approval_instances" ("id", "tenantId", "entityType", "entityId", "status", "currentStepOrder", "round", "steps", "adminOverride", "allowSelfApproval", "requesterEmployeeId", "requesterUserId", "amount", "days", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id")::uuid::text, r."tenantId", 'EXPENSE'::"WorkflowEntityType", r."id", 'PENDING'::"ApprovalInstanceStatus", 1, 1,
       '[{"order":1,"name":"Reporting manager","approverType":"REPORTING_MANAGER","approverUserId":null,"approverRole":null}]'::jsonb,
       true, true, r."employeeId", (SELECT u."id" FROM "users" u WHERE u."employeeId" = r."employeeId" LIMIT 1), r."amount", NULL, r."createdAt", CURRENT_TIMESTAMP
FROM "expense_claims" r WHERE r."status" = 'SUBMITTED';

INSERT INTO "approval_instances" ("id", "tenantId", "entityType", "entityId", "status", "currentStepOrder", "round", "steps", "adminOverride", "allowSelfApproval", "requesterEmployeeId", "requesterUserId", "amount", "days", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id")::uuid::text, r."tenantId", 'LOAN'::"WorkflowEntityType", r."id", 'PENDING'::"ApprovalInstanceStatus", 1, 1,
       '[{"order":1,"name":"HR approval","approverType":"HR_ADMIN","approverUserId":null,"approverRole":null}]'::jsonb,
       true, true, r."employeeId", (SELECT u."id" FROM "users" u WHERE u."employeeId" = r."employeeId" LIMIT 1), r."principal", NULL, r."createdAt", CURRENT_TIMESTAMP
FROM "employee_loans" r WHERE r."status" = 'REQUESTED';

INSERT INTO "approval_instances" ("id", "tenantId", "entityType", "entityId", "status", "currentStepOrder", "round", "steps", "adminOverride", "allowSelfApproval", "requesterEmployeeId", "requesterUserId", "amount", "days", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id")::uuid::text, r."tenantId", 'COMP_OFF'::"WorkflowEntityType", r."id", 'PENDING'::"ApprovalInstanceStatus", 1, 1,
       '[{"order":1,"name":"Reporting manager","approverType":"REPORTING_MANAGER","approverUserId":null,"approverRole":null}]'::jsonb,
       true, true, r."employeeId", (SELECT u."id" FROM "users" u WHERE u."employeeId" = r."employeeId" LIMIT 1), NULL, r."earnedDays", r."createdAt", CURRENT_TIMESTAMP
FROM "comp_off_requests" r WHERE r."status" = 'PENDING';

INSERT INTO "approval_instances" ("id", "tenantId", "entityType", "entityId", "status", "currentStepOrder", "round", "steps", "adminOverride", "allowSelfApproval", "requesterEmployeeId", "requesterUserId", "amount", "days", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id")::uuid::text, r."tenantId", 'REGULARIZATION'::"WorkflowEntityType", r."id", 'PENDING'::"ApprovalInstanceStatus", 1, 1,
       '[{"order":1,"name":"Reporting manager","approverType":"REPORTING_MANAGER","approverUserId":null,"approverRole":null}]'::jsonb,
       true, true, r."employeeId", (SELECT u."id" FROM "users" u WHERE u."employeeId" = r."employeeId" LIMIT 1), NULL, NULL, r."createdAt", CURRENT_TIMESTAMP
FROM "attendance_regularizations" r WHERE r."status" = 'PENDING';

-- Legacy computed runs have no recorded maker, so maker-checker cannot bind them.
INSERT INTO "approval_instances" ("id", "tenantId", "entityType", "entityId", "status", "currentStepOrder", "round", "steps", "adminOverride", "allowSelfApproval", "requesterEmployeeId", "requesterUserId", "amount", "days", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || r."id")::uuid::text, r."tenantId", 'PAYROLL_RUN'::"WorkflowEntityType", r."id", 'PENDING'::"ApprovalInstanceStatus", 1, 1,
       '[{"order":1,"name":"HR approval","approverType":"HR_ADMIN","approverUserId":null,"approverRole":null}]'::jsonb,
       true, false, NULL, NULL, r."totalNet", NULL, r."createdAt", CURRENT_TIMESTAMP
FROM "payroll_runs" r WHERE r."status" = 'COMPUTED';
