-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "description" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "Provider",
    "providerReference" TEXT,
    "fee" DOUBLE PRECISION,
    "metadata" JSONB,
    "apiKeyId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttempt" TIMESTAMP(3),
    "nextAttempt" TIMESTAMP(3),
    "response" JSONB,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "provider" TEXT,
    "provider_signature" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_audit_logs" (
    "id" TEXT NOT NULL,
    "transferId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfers_transferId_key" ON "transfers"("transferId");

-- CreateIndex
CREATE INDEX "transfers_transferId_idx" ON "transfers"("transferId");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE INDEX "transfers_from_idx" ON "transfers"("from");

-- CreateIndex
CREATE INDEX "transfers_to_idx" ON "transfers"("to");

-- CreateIndex
CREATE INDEX "transfers_apiKeyId_idx" ON "transfers"("apiKeyId");

-- CreateIndex
CREATE INDEX "transfers_provider_idx" ON "transfers"("provider");

-- CreateIndex
CREATE INDEX "transfer_webhook_deliveries_transferId_idx" ON "transfer_webhook_deliveries"("transferId");

-- CreateIndex
CREATE INDEX "transfer_webhook_deliveries_status_idx" ON "transfer_webhook_deliveries"("status");

-- CreateIndex
CREATE INDEX "transfer_webhook_deliveries_nextAttempt_idx" ON "transfer_webhook_deliveries"("nextAttempt");

-- CreateIndex
CREATE INDEX "transfer_webhook_deliveries_provider_idx" ON "transfer_webhook_deliveries"("provider");

-- CreateIndex
CREATE INDEX "transfer_audit_logs_transferId_idx" ON "transfer_audit_logs"("transferId");

-- CreateIndex
CREATE INDEX "transfer_audit_logs_userId_idx" ON "transfer_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "transfer_audit_logs_action_idx" ON "transfer_audit_logs"("action");

-- CreateIndex
CREATE INDEX "transfer_audit_logs_entityType_idx" ON "transfer_audit_logs"("entityType");

-- CreateIndex
CREATE INDEX "transfer_audit_logs_createdAt_idx" ON "transfer_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_webhook_deliveries" ADD CONSTRAINT "transfer_webhook_deliveries_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_audit_logs" ADD CONSTRAINT "transfer_audit_logs_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
