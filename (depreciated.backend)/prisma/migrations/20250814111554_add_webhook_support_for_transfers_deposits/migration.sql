-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "depositId" TEXT,
ADD COLUMN     "transferId" TEXT,
ALTER COLUMN "paymentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "webhook_deliveries_transferId_idx" ON "webhook_deliveries"("transferId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_depositId_idx" ON "webhook_deliveries"("depositId");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
