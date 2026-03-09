-- AlterTable: add financialTransactionId to non-payment tables
ALTER TABLE "deposits" ADD COLUMN IF NOT EXISTS "financialTransactionId" TEXT;
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "financialTransactionId" TEXT;
ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "financialTransactionId" TEXT;
