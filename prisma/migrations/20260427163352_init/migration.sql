-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('GUEST', 'REGISTRANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "RegistryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GiftItemStatus" AS ENUM ('PENDING', 'FUNDED', 'PURCHASED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "GiftItemPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('PARENT', 'SIBLING', 'CHILD', 'COUSIN', 'UNCLE_AUNT', 'FAMILY_FRIEND', 'OTHER');

-- CreateEnum
CREATE TYPE "KinshipTier" AS ENUM ('CLOSE', 'EXTENDED', 'FRIEND');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'GUEST',
    "provider" TEXT NOT NULL DEFAULT 'local',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "coupleName" TEXT NOT NULL,
    "weddingDate" TIMESTAMP(3) NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "shareCode" TEXT NOT NULL,
    "status" "RegistryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_items" (
    "id" SERIAL NOT NULL,
    "registryId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "targetAmountKzt" DECIMAL(12,2) NOT NULL,
    "currentAmountKzt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "targetAmountEur" DECIMAL(10,2),
    "exchangeRateAtTime" DECIMAL(10,6),
    "lockedAt" TIMESTAMP(3),
    "status" "GiftItemStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "GiftItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" SERIAL NOT NULL,
    "giftItemId" INTEGER NOT NULL,
    "userId" INTEGER,
    "contributorName" TEXT NOT NULL,
    "amountKzt" DECIMAL(12,2) NOT NULL,
    "amountEur" DECIMAL(10,2),
    "exchangeRateAtTime" DECIMAL(10,6) NOT NULL,
    "lockedAtTimestamp" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "relatedUserId" INTEGER,
    "name" TEXT NOT NULL,
    "relationshipType" "RelationshipType" NOT NULL,
    "kinshipTier" "KinshipTier" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" INTEGER NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate_snapshots" (
    "id" SERIAL NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(10,6) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "registries_shareCode_key" ON "registries"("shareCode");

-- CreateIndex
CREATE INDEX "registries_userId_idx" ON "registries"("userId");

-- CreateIndex
CREATE INDEX "registries_shareCode_idx" ON "registries"("shareCode");

-- CreateIndex
CREATE INDEX "registries_status_idx" ON "registries"("status");

-- CreateIndex
CREATE INDEX "gift_items_registryId_idx" ON "gift_items"("registryId");

-- CreateIndex
CREATE INDEX "gift_items_status_idx" ON "gift_items"("status");

-- CreateIndex
CREATE INDEX "gift_items_registryId_status_idx" ON "gift_items"("registryId", "status");

-- CreateIndex
CREATE INDEX "contributions_giftItemId_idx" ON "contributions"("giftItemId");

-- CreateIndex
CREATE INDEX "contributions_userId_idx" ON "contributions"("userId");

-- CreateIndex
CREATE INDEX "contributions_giftItemId_status_idx" ON "contributions"("giftItemId", "status");

-- CreateIndex
CREATE INDEX "contributions_createdAt_idx" ON "contributions"("createdAt");

-- CreateIndex
CREATE INDEX "family_members_userId_idx" ON "family_members"("userId");

-- CreateIndex
CREATE INDEX "family_members_relatedUserId_idx" ON "family_members"("relatedUserId");

-- CreateIndex
CREATE INDEX "family_members_userId_kinshipTier_idx" ON "family_members"("userId", "kinshipTier");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "exchange_rate_snapshots_fromCurrency_toCurrency_idx" ON "exchange_rate_snapshots"("fromCurrency", "toCurrency");

-- CreateIndex
CREATE INDEX "exchange_rate_snapshots_createdAt_idx" ON "exchange_rate_snapshots"("createdAt");

-- AddForeignKey
ALTER TABLE "registries" ADD CONSTRAINT "registries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_items" ADD CONSTRAINT "gift_items_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "registries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_giftItemId_fkey" FOREIGN KEY ("giftItemId") REFERENCES "gift_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_relatedUserId_fkey" FOREIGN KEY ("relatedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
