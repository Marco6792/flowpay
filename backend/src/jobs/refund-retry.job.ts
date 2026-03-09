import { RefundErrorService } from '../services/refund-error.service.ts';
import { ProviderFactory } from '../services/providers/provider.factory.ts';
import { logger } from '../utils/logger.ts';
import { prisma } from '../utils/database.ts';
import { Prisma } from '@prisma/client';

/**
 * Background job to handle refund retries
 */
export class RefundRetryJob {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the refund retry job
   */
  static start(intervalMs: number = 60000): void { // Default: run every minute
    if (this.isRunning) {
      logger.warn('Refund retry job is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ intervalMs }, 'Starting refund retry job');

    this.intervalId = setInterval(async () => {
      try {
        await this.processRetries();
      } catch (error) {
        logger.error({ error }, 'Error in refund retry job');
      }
    }, intervalMs);
  }

  /**
   * Stop the refund retry job
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Stopped refund retry job');
  }

  /**
   * Process all eligible refund retries
   */
  static async processRetries(): Promise<void> {
    try {
      const refundsToRetry = await RefundErrorService.getRefundsForRetry();

      if (refundsToRetry.length === 0) {
        logger.debug('No refunds eligible for retry');
        return;
      }

      logger.info({ count: refundsToRetry.length }, 'Processing refund retries');

      for (const refund of refundsToRetry) {
        try {
          await this.retryRefund(refund);
        } catch (error) {
          logger.error({
            error,
            refundId: refund.id,
            refundReferenceId: refund.refundReferenceId
          }, 'Error retrying individual refund');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error processing refund retries');
    }
  }

  /**
   * Retry a specific refund
   */
  private static async retryRefund(refund: {
    id: string;
    refundReferenceId: string;
    paymentId: string;
    retryCount: number;
  }): Promise<void> {
    try {
      logger.info({
        refundId: refund.id,
        refundReferenceId: refund.refundReferenceId,
        retryCount: refund.retryCount,
      }, 'Retrying refund');

      // Get the original payment to determine provider
      const payment = await prisma.payment.findUnique({
        where: { id: refund.paymentId },
        select: { id: true, provider: true, transactionId: true, amount: true },
      });

      if (!payment) {
        logger.error({ refundId: refund.id }, 'Original payment not found for refund retry');
        return;
      }

      // Get the provider
      if (!payment.provider) {
        logger.error({
          refundId: refund.id,
          paymentId: payment.id
        }, 'Payment has no provider set');
        return;
      }

      const provider = ProviderFactory.getProvider(payment.provider.toLowerCase() as any);
      if (!provider) {
        logger.error({
          refundId: refund.id,
          provider: payment.provider
        }, 'Provider not available for refund retry');
        return;
      }

      // Check refund status with provider
      const statusResult = await provider.checkRefundStatus(refund.refundReferenceId);

      // Update refund based on status
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: statusResult.status as any,
          completedAt: statusResult.status === 'COMPLETED' ? new Date() : null,
          financialTransactionId: (statusResult as any).financialTransactionId || undefined,
          providerResponse: {
            ...((await prisma.refund.findUnique({ where: { id: refund.id } }))?.providerResponse as any || {}),
            lastStatusCheck: new Date(),
            statusResult,
          },
        } as any,
      });

      // Update payment status if refund is completed
      if (statusResult.status === 'COMPLETED') {
        await prisma.payment.update({
          where: { id: refund.paymentId },
          data: { status: 'REFUNDED' },
        });

        logger.info({
          refundId: refund.id,
          refundReferenceId: refund.refundReferenceId,
          paymentId: refund.paymentId,
        }, 'Refund completed successfully on retry');
      } else if (statusResult.status === 'FAILED') {
        logger.warn({
          refundId: refund.id,
          refundReferenceId: refund.refundReferenceId,
          failureReason: statusResult.failureReason,
        }, 'Refund failed permanently on retry');
      } else {
        logger.info({
          refundId: refund.id,
          refundReferenceId: refund.refundReferenceId,
          status: statusResult.status,
        }, 'Refund still in progress on retry');
      }
    } catch (error) {
      logger.error({
        error,
        refundId: refund.id,
        refundReferenceId: refund.refundReferenceId
      }, 'Error during refund retry');
    }
  }

  /**
   * Get job status
   */
  static getStatus(): {
    isRunning: boolean;
    intervalId: NodeJS.Timeout | null;
  } {
    return {
      isRunning: this.isRunning,
      intervalId: this.intervalId,
    };
  }

  /**
   * Process a single refund retry manually
   */
  static async processRefundRetry(refundId: string): Promise<{
    success: boolean;
    message: string;
    status?: string;
  }> {
    try {
      const refund = await prisma.refund.findUnique({
        where: { id: refundId },
        include: {
          payment: {
            select: { provider: true, transactionId: true, amount: true },
          },
        },
      });

      if (!refund) {
        return {
          success: false,
          message: 'Refund not found',
        };
      }

      if (!refund.payment) {
        return {
          success: false,
          message: 'Original payment not found',
        };
      }

      await this.retryRefund({
        id: refund.id,
        refundReferenceId: refund.refundReferenceId,
        paymentId: refund.paymentId,
        retryCount: ((refund.providerResponse as any)?.retryCount || 0),
      });

      // Get updated refund status
      const updatedRefund = await prisma.refund.findUnique({
        where: { id: refundId },
        select: { status: true },
      });

      return {
        success: true,
        message: 'Refund retry processed successfully',
        status: updatedRefund?.status,
      };
    } catch (error) {
      logger.error({ error, refundId }, 'Error processing manual refund retry');
      return {
        success: false,
        message: `Error processing refund retry: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get retry statistics
   */
  static async getRetryStatistics(): Promise<{
    pendingRetries: number;
    completedRetries: number;
    failedRetries: number;
    averageRetryCount: number;
  }> {
    try {
      const [pendingRetries, completedRetries, failedRetries, allRefunds] = await Promise.all([
        prisma.refund.count({
          where: {
            status: 'PROCESSING',
            providerResponse: {
              path: ['nextRetryAt'],
              not: Prisma.JsonNull,
            },
          },
        }),
        prisma.refund.count({
          where: {
            status: 'COMPLETED',
            providerResponse: {
              path: ['retryCount'],
              gt: 0,
            },
          },
        }),
        prisma.refund.count({
          where: {
            status: 'FAILED',
            providerResponse: {
              path: ['retryCount'],
              gt: 0,
            },
          },
        }),
        prisma.refund.findMany({
          where: {
            providerResponse: {
              path: ['retryCount'],
              gt: 0,
            },
          },
          select: {
            providerResponse: true,
          },
        }),
      ]);

      const totalRetryCount = allRefunds.reduce((sum, refund) => {
        const metadata = (refund.providerResponse as any) || {};
        return sum + (metadata.retryCount || 0);
      }, 0);

      const averageRetryCount = allRefunds.length > 0 ? totalRetryCount / allRefunds.length : 0;

      return {
        pendingRetries,
        completedRetries,
        failedRetries,
        averageRetryCount: Math.round(averageRetryCount * 100) / 100, // Round to 2 decimal places
      };
    } catch (error) {
      logger.error({ error }, 'Error getting retry statistics');
      return {
        pendingRetries: 0,
        completedRetries: 0,
        failedRetries: 0,
        averageRetryCount: 0,
      };
    }
  }
}
