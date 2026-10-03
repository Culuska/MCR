-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('EQUIPMENT', 'VEHICLE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'UNDER_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('OWNED', 'HIRED');

-- CreateEnum
CREATE TYPE "RentalRate" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('SERVICE', 'REPAIR');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "assetId" TEXT;

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "type" TEXT NOT NULL,
    "registration" TEXT,
    "ownership" "Ownership" NOT NULL DEFAULT 'OWNED',
    "purchasePrice" DECIMAL(14,2),
    "fuelType" TEXT,
    "driver" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "insuranceExpiry" DATE,
    "nextServiceDate" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetUsage" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "projectId" TEXT,
    "operator" TEXT,
    "startReading" DECIMAL(10,1) NOT NULL,
    "endReading" DECIMAL(10,1) NOT NULL,
    "units" DECIMAL(10,1) NOT NULL,
    "trips" INTEGER NOT NULL DEFAULT 0,
    "fuelLitres" DECIMAL(8,1) NOT NULL DEFAULT 0,
    "purpose" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "rateType" "RentalRate" NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "deposit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "RentalStatus" NOT NULL DEFAULT 'ACTIVE',
    "expenseId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "MaintenanceKind" NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "nextServiceDate" DATE,
    "expenseId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_startDate_idx" ON "AssetAssignment"("assetId", "startDate");

-- CreateIndex
CREATE INDEX "AssetUsage_assetId_date_idx" ON "AssetUsage"("assetId", "date");

-- CreateIndex
CREATE INDEX "AssetUsage_projectId_idx" ON "AssetUsage"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Rental_number_key" ON "Rental"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Rental_expenseId_key" ON "Rental"("expenseId");

-- CreateIndex
CREATE INDEX "Rental_assetId_startDate_idx" ON "Rental"("assetId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRecord_expenseId_key" ON "MaintenanceRecord"("expenseId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_assetId_date_idx" ON "MaintenanceRecord"("assetId", "date");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetUsage" ADD CONSTRAINT "AssetUsage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetUsage" ADD CONSTRAINT "AssetUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

