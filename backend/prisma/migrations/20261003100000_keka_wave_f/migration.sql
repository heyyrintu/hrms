-- CreateEnum
CREATE TYPE "GoalOwnerType" AS ENUM ('COMPANY', 'DEPARTMENT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "KeyResultMetricType" AS ENUM ('NUMBER', 'PERCENT', 'CURRENCY', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ReviewQuestionType" AS ENUM ('RATING', 'TEXT');

-- CreateEnum
CREATE TYPE "ReviewAudience" AS ENUM ('SELF', 'MANAGER', 'PEER');

-- CreateEnum
CREATE TYPE "PeerReviewStatus" AS ENUM ('NOMINATED', 'APPROVED', 'REJECTED', 'SUBMITTED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RESULTS_RELEASED';
ALTER TYPE "NotificationType" ADD VALUE 'PEER_NOMINATION_PENDING';
ALTER TYPE "NotificationType" ADD VALUE 'PEER_FEEDBACK_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_CALIBRATED';

-- AlterTable
ALTER TABLE "review_cycles" ADD COLUMN     "maxPeers" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "peerFeedbackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "performance_reviews" ADD COLUMN     "calibratedAt" TIMESTAMP(3),
ADD COLUMN     "calibratedById" TEXT,
ADD COLUMN     "calibratedRating" INTEGER,
ADD COLUMN     "calibrationReason" TEXT,
ADD COLUMN     "potentialRating" INTEGER;

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "ownerType" "GoalOwnerType" NOT NULL DEFAULT 'EMPLOYEE',
ADD COLUMN     "parentGoalId" TEXT,
ADD COLUMN     "shareOnFeed" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "reviewId" DROP NOT NULL,
ALTER COLUMN "employeeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "key_results" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metricType" "KeyResultMetricType" NOT NULL DEFAULT 'NUMBER',
    "startValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "targetValue" DECIMAL(14,2) NOT NULL,
    "currentValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit" TEXT,
    "weight" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_questions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "ReviewQuestionType" NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_template_questions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "audience" "ReviewAudience" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "review_template_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cycle_questions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "questionId" TEXT,
    "text" TEXT NOT NULL,
    "type" "ReviewQuestionType" NOT NULL,
    "audience" "ReviewAudience" NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "review_cycle_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_answers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "cycleQuestionId" TEXT NOT NULL,
    "audience" "ReviewAudience" NOT NULL,
    "rating" INTEGER,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designation_competencies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "designationId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "expectedLevel" INTEGER NOT NULL,

    CONSTRAINT "designation_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_competency_ratings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "competencyId" TEXT,
    "name" TEXT NOT NULL,
    "expectedLevel" INTEGER NOT NULL,
    "managerRating" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_competency_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "peerEmployeeId" TEXT NOT NULL,
    "nominatedByEmployeeId" TEXT,
    "status" "PeerReviewStatus" NOT NULL DEFAULT 'NOMINATED',
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "overallComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_review_answers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "peerReviewId" TEXT NOT NULL,
    "cycleQuestionId" TEXT NOT NULL,
    "rating" INTEGER,
    "text" TEXT,

    CONSTRAINT "peer_review_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "key_results_tenantId_idx" ON "key_results"("tenantId");

-- CreateIndex
CREATE INDEX "key_results_goalId_idx" ON "key_results"("goalId");

-- CreateIndex
CREATE INDEX "review_questions_tenantId_idx" ON "review_questions"("tenantId");

-- CreateIndex
CREATE INDEX "review_templates_tenantId_idx" ON "review_templates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "review_templates_tenantId_name_key" ON "review_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "review_template_questions_tenantId_idx" ON "review_template_questions"("tenantId");

-- CreateIndex
CREATE INDEX "review_template_questions_questionId_idx" ON "review_template_questions"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "review_template_questions_templateId_questionId_audience_key" ON "review_template_questions"("templateId", "questionId", "audience");

-- CreateIndex
CREATE INDEX "review_cycle_questions_tenantId_idx" ON "review_cycle_questions"("tenantId");

-- CreateIndex
CREATE INDEX "review_cycle_questions_cycleId_idx" ON "review_cycle_questions"("cycleId");

-- CreateIndex
CREATE INDEX "review_answers_tenantId_idx" ON "review_answers"("tenantId");

-- CreateIndex
CREATE INDEX "review_answers_cycleQuestionId_idx" ON "review_answers"("cycleQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "review_answers_reviewId_cycleQuestionId_key" ON "review_answers"("reviewId", "cycleQuestionId");

-- CreateIndex
CREATE INDEX "competencies_tenantId_idx" ON "competencies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_tenantId_name_key" ON "competencies"("tenantId", "name");

-- CreateIndex
CREATE INDEX "designation_competencies_tenantId_idx" ON "designation_competencies"("tenantId");

-- CreateIndex
CREATE INDEX "designation_competencies_competencyId_idx" ON "designation_competencies"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "designation_competencies_designationId_competencyId_key" ON "designation_competencies"("designationId", "competencyId");

-- CreateIndex
CREATE INDEX "review_competency_ratings_tenantId_idx" ON "review_competency_ratings"("tenantId");

-- CreateIndex
CREATE INDEX "review_competency_ratings_reviewId_idx" ON "review_competency_ratings"("reviewId");

-- CreateIndex
CREATE INDEX "peer_reviews_tenantId_idx" ON "peer_reviews"("tenantId");

-- CreateIndex
CREATE INDEX "peer_reviews_tenantId_peerEmployeeId_status_idx" ON "peer_reviews"("tenantId", "peerEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "peer_reviews_reviewId_peerEmployeeId_key" ON "peer_reviews"("reviewId", "peerEmployeeId");

-- CreateIndex
CREATE INDEX "peer_review_answers_tenantId_idx" ON "peer_review_answers"("tenantId");

-- CreateIndex
CREATE INDEX "peer_review_answers_cycleQuestionId_idx" ON "peer_review_answers"("cycleQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "peer_review_answers_peerReviewId_cycleQuestionId_key" ON "peer_review_answers"("peerReviewId", "cycleQuestionId");

-- CreateIndex
CREATE INDEX "goals_tenantId_ownerType_idx" ON "goals"("tenantId", "ownerType");

-- CreateIndex
CREATE INDEX "goals_parentGoalId_idx" ON "goals"("parentGoalId");

-- CreateIndex
CREATE INDEX "goals_departmentId_idx" ON "goals"("departmentId");

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "review_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_questions" ADD CONSTRAINT "review_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_template_questions" ADD CONSTRAINT "review_template_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_template_questions" ADD CONSTRAINT "review_template_questions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "review_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_template_questions" ADD CONSTRAINT "review_template_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "review_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycle_questions" ADD CONSTRAINT "review_cycle_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycle_questions" ADD CONSTRAINT "review_cycle_questions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "performance_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_cycleQuestionId_fkey" FOREIGN KEY ("cycleQuestionId") REFERENCES "review_cycle_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designation_competencies" ADD CONSTRAINT "designation_competencies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designation_competencies" ADD CONSTRAINT "designation_competencies_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designation_competencies" ADD CONSTRAINT "designation_competencies_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_competency_ratings" ADD CONSTRAINT "review_competency_ratings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_competency_ratings" ADD CONSTRAINT "review_competency_ratings_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "performance_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "performance_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_peerEmployeeId_fkey" FOREIGN KEY ("peerEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_nominatedByEmployeeId_fkey" FOREIGN KEY ("nominatedByEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_review_answers" ADD CONSTRAINT "peer_review_answers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_review_answers" ADD CONSTRAINT "peer_review_answers_peerReviewId_fkey" FOREIGN KEY ("peerReviewId") REFERENCES "peer_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_review_answers" ADD CONSTRAINT "peer_review_answers_cycleQuestionId_fkey" FOREIGN KEY ("cycleQuestionId") REFERENCES "review_cycle_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Wave F: existing completed goals get a completion time (no feed posts for them).
UPDATE "goals" SET "completedAt" = "updatedAt" WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;
