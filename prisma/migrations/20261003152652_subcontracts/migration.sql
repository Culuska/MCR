-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CertStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "Subcontract" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "contractValue" DECIMAL(14,2) NOT NULL,
    "retentionPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "status" "SubStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subcontract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubVariation" (
    "id" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubCertificate" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "workToDate" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "retention" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "status" "CertStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "payAccountId" TEXT,
    "payMethod" "PaymentMethod",
    "payReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRelease" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubScheduleItem" (
    "id" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE NOT NULL,

    CONSTRAINT "SubScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subcontract_number_key" ON "Subcontract"("number");

-- CreateIndex
CREATE INDEX "Subcontract_projectId_idx" ON "Subcontract"("projectId");

-- CreateIndex
CREATE INDEX "Subcontract_supplierId_idx" ON "Subcontract"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SubCertificate_number_key" ON "SubCertificate"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SubCertificate_subcontractId_seq_key" ON "SubCertificate"("subcontractId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRelease_number_key" ON "RetentionRelease"("number");

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubVariation" ADD CONSTRAINT "SubVariation_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCertificate" ADD CONSTRAINT "SubCertificate_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRelease" ADD CONSTRAINT "RetentionRelease_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubScheduleItem" ADD CONSTRAINT "SubScheduleItem_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

