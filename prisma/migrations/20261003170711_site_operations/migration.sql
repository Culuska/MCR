-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('DELAY', 'SAFETY', 'MATERIAL_SHORTAGE', 'EQUIPMENT_BREAKDOWN', 'WEATHER', 'DESIGN_QUERY', 'OTHER');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "taskId" TEXT;

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "startDate" DATE,
    "dueDate" DATE NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "completion" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(14,2),
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weather" TEXT,
    "workDone" TEXT NOT NULL,
    "planNext" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reviewedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTaskUpdate" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "completion" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "ReportTaskUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteIssue" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportId" TEXT,
    "taskId" TEXT,
    "date" DATE NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "description" TEXT NOT NULL,
    "daysLost" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReport_projectId_date_key" ON "SiteReport"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTaskUpdate_reportId_taskId_key" ON "ReportTaskUpdate"("reportId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteIssue_number_key" ON "SiteIssue"("number");

-- CreateIndex
CREATE INDEX "SiteIssue_projectId_resolved_idx" ON "SiteIssue"("projectId", "resolved");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTaskUpdate" ADD CONSTRAINT "ReportTaskUpdate_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SiteReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTaskUpdate" ADD CONSTRAINT "ReportTaskUpdate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SiteReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIssue" ADD CONSTRAINT "SiteIssue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

