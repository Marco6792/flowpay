import { RefundTransactionErrorCode, RefundTransactionErrorMessages, RefundErrorDetails, isRetryableError } from '../types/refund-errors';
import { logger } from '../utils/logger';
import { prisma } from '../utils/database';

/**
 * Service for handling refund errors and retry logic
 */
export class RefundErrorService {
  /**
   * Process a refund error and determine next steps
   */
  static async processRefundError(
    refundId: string,
    errorDetails: RefundErrorDetails
  ): Promise<{
    shouldRetry: boolean;
    retryAfter?: number;
    maxRetries: number;
    currentRetries: number;
  }> {
    try {
      // Get current refund record
      const refund = await prisma.refund.findUnique({
        where: { id: refundId },
      });

      if (!refund) {
        logger.error({ refundId }, 'Refund not found for error processing');
        return {
          shouldRetry: false,
          maxRetries: 0,
          currentRetries: 0,
        };
      }

      // Extract retry count from metadata
      const metadata = (refund.providerResponse as any) || {};
      const currentRetries = metadata.retryCount || 0;
      const maxRetries = this.getMaxRetriesForError(errorDetails.code);

      // Determine if we should retry
      const shouldRetry = isRetryableError(errorDetails.code) && currentRetries < maxRetries;
      const retryAfter = shouldRetry ? this.getRetryDelayForError(errorDetails.code, currentRetries) : undefined;

      logger.info({
        refundId,
        errorCode: errorDetails.code,
        currentRetries,
        maxRetries,
        shouldRetry,
        retryAfter,
      }, 'Processed refund error');

      return {
        shouldRetry,
        retryAfter,
        maxRetries,
        currentRetries,
      };
    } catch (error) {
      logger.error({ error, refundId }, 'Error processing refund error');
      return {
        shouldRetry: false,
        maxRetries: 0,
        currentRetries: 0,
      };
    }
  }

  /**
   * Update refund with error details and retry information
   */
  static async updateRefundWithError(
    refundId: string,
    errorDetails: RefundErrorDetails,
    retryInfo: { shouldRetry: boolean; retryAfter?: number; currentRetries: number }
  ): Promise<void> {
    try {
      const refund = await prisma.refund.findUnique({
        where: { id: refundId },
      });

      if (!refund) {
        logger.error({ refundId }, 'Refund not found for error update');
        return;
      }

      const currentMetadata = (refund.providerResponse as any) || {};
      const updatedMetadata = {
        ...currentMetadata,
        errorDetails,
        retryCount: retryInfo.currentRetries + (retryInfo.shouldRetry ? 1 : 0),
        lastRetryAt: new Date(),
        nextRetryAt: retryInfo.retryAfter ? new Date(Date.now() + retryInfo.retryAfter * 1000) : null,
      };

      await prisma.refund.update({
        where: { id: refundId },
        data: {
          providerResponse: updatedMetadata,
          status: retryInfo.shouldRetry ? 'PROCESSING' : 'FAILED',
        },
      });

      logger.info({
        refundId,
        errorCode: errorDetails.code,
        retryCount: updatedMetadata.retryCount,
        nextRetryAt: updatedMetadata.nextRetryAt,
      }, 'Updated refund with error details');
    } catch (error) {
      logger.error({ error, refundId }, 'Error updating refund with error details');
    }
  }

  /**
   * Get maximum retry attempts for a specific error code
   */
  private static getMaxRetriesForError(errorCode: RefundTransactionErrorCode): number {
    const retryLimits: Record<RefundTransactionErrorCode, number> = {
      [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_REJECTED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_EXPIRED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_ONGOING]: 5,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_DELAYED]: 3,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CURRENCY]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR]: 3,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_SERVICE_UNAVAILABLE]: 5,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION]: 3,
    };

    return retryLimits[errorCode] || 0;
  }

  /**
   * Get retry delay in seconds for a specific error code and retry attempt
   */
  private static getRetryDelayForError(errorCode: RefundTransactionErrorCode, retryAttempt: number): number {
    const baseDelays: Record<RefundTransactionErrorCode, number> = {
      [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_REJECTED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_EXPIRED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_ONGOING]: 30, // 30 seconds
      [RefundTransactionErrorCode.REFUND_TRANSACTION_DELAYED]: 60, // 1 minute
      [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CURRENCY]: 0,
      [RefundTransactionErrorCode.REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR]: 120, // 2 minutes
      [RefundTransactionErrorCode.REFUND_TRANSACTION_SERVICE_UNAVAILABLE]: 300, // 5 minutes
      [RefundTransactionErrorCode.REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION]: 180, // 3 minutes
    };

    const baseDelay = baseDelays[errorCode] || 0;
    
    // Exponential backoff: delay * (2 ^ retryAttempt)
    return baseDelay * Math.pow(2, retryAttempt);
  }

  /**
   * Get all refunds that are eligible for retry
   */
  static async getRefundsForRetry(): Promise<Array<{
    id: string;
    refundReferenceId: string;
    paymentId: string;
    nextRetryAt: Date;
    retryCount: number;
  }>> {
    try {
      const refunds = await prisma.refund.findMany({
        where: {
          status: 'PROCESSING',
          providerResponse: {
            path: ['nextRetryAt'],
            lte: new Date(),
          },
        },
        select: {
          id: true,
          refundReferenceId: true,
          paymentId: true,
          providerResponse: true,
        },
      });

      return refunds.map(refund => {
        const metadata = (refund.providerResponse as any) || {};
        return {
          id: refund.id,
          refundReferenceId: refund.refundReferenceId,
          paymentId: refund.paymentId,
          nextRetryAt: new Date(metadata.nextRetryAt),
          retryCount: metadata.retryCount || 0,
        };
      });
    } catch (error) {
      logger.error({ error }, 'Error getting refunds for retry');
      return [];
    }
  }

  /**
   * Get error statistics for monitoring
   */
  static async getErrorStatistics(timeRange: { from: Date; to: Date }): Promise<{
    totalErrors: number;
    errorsByCode: Record<string, number>;
    retryableErrors: number;
    nonRetryableErrors: number;
  }> {
    try {
      const refunds = await prisma.refund.findMany({
        where: {
          createdAt: {
            gte: timeRange.from,
            lte: timeRange.to,
          },
          status: 'FAILED',
        },
        select: {
          providerResponse: true,
        },
      });

      const errorsByCode: Record<string, number> = {};
      let retryableErrors = 0;
      let nonRetryableErrors = 0;

      refunds.forEach(refund => {
        const metadata = (refund.providerResponse as any) || {};
        const errorDetails = metadata.errorDetails;
        
        if (errorDetails && errorDetails.code) {
          const errorCode = errorDetails.code.toString();
          errorsByCode[errorCode] = (errorsByCode[errorCode] || 0) + 1;
          
          if (errorDetails.retryable) {
            retryableErrors++;
          } else {
            nonRetryableErrors++;
          }
        }
      });

      return {
        totalErrors: refunds.length,
        errorsByCode,
        retryableErrors,
        nonRetryableErrors,
      };
    } catch (error) {
      logger.error({ error }, 'Error getting error statistics');
      return {
        totalErrors: 0,
        errorsByCode: {},
        retryableErrors: 0,
        nonRetryableErrors: 0,
      };
    }
  }
}
