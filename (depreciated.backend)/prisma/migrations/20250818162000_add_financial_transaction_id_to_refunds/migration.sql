-- AlterTable: add financialTransactionId to refunds
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "financialTransactionId" TEXT;
