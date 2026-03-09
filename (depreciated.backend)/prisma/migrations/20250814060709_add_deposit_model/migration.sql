-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "description" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "Provider",
    "providerReference" TEXT,
    "fee" DOUBLE PRECISION,
    "metadata" JSONB,
    "apiKeyId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deposits_depositId_key" ON "deposits"("depositId");

-- CreateIndex
CREATE INDEX "deposits_depositId_idx" ON "deposits"("depositId");

-- CreateIndex
CREATE INDEX "deposits_accountId_idx" ON "deposits"("accountId");

-- CreateIndex
CREATE INDEX "deposits_apiKeyId_idx" ON "deposits"("apiKeyId");

-- CreateIndex
CREATE INDEX "deposits_userId_idx" ON "deposits"("userId");

-- CreateIndex
CREATE INDEX "deposits_status_idx" ON "deposits"("status");

-- CreateIndex
CREATE INDEX "deposits_provider_idx" ON "deposits"("provider");

-- CreateIndex
CREATE INDEX "deposits_createdAt_idx" ON "deposits"("createdAt");

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
