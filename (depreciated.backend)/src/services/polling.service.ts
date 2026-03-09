import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { ProviderFactory } from './providers/provider.factory.ts';
import { env } from '../config/env.ts';
import { DepositStatusEnum, TransferStatusEnum, WithdrawStatusEnum } from './providers/provider.interface.ts';

export class PollingService {
  private static instance: PollingService;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Polling configuration
  private readonly POLLING_INTERVAL = 5000; // 5 seconds
  private readonly MAX_ATTEMPTS = 12; // 60 seconds total (5s * 12)
  private readonly INITIAL_DELAY = 3000; // Wait 3s before first poll

  private constructor() {}

  static getInstance(): PollingService {
    if (!PollingService.instance) {
      PollingService.instance = new PollingService();
    }
    return PollingService.instance;
  }


  /**
   * Start polling for a deposit transaction
   */
  async startDepositPolling(depositId: string, providerType: string, providerTransactionId: string): Promise<void> {
    const key = `deposit_${depositId}`;

    // Don't start if already polling
    if (this.pollingIntervals.has(key)) {
      logger.info({ depositId, key }, 'Deposit polling already active');
      return;
    }

    // Only poll in sandbox environment
    if (env.NODE_ENV === 'production') {
      logger.info({ depositId }, 'Skipping deposit polling in production - using webhooks');
      return;
    }

    logger.info({
      depositId,
      providerType,
      providerTransactionId
    }, 'Starting deposit auto-polling');

    let attempts = 0;

    // Initial delay before first poll
    setTimeout(() => {
      const intervalId = setInterval(async () => {
        attempts++;

        try {
          const success = await this.pollDepositStatus(depositId, providerType, providerTransactionId, attempts);

          if (success || attempts >= this.MAX_ATTEMPTS) {
            this.stopPolling(key);

            if (!success && attempts >= this.MAX_ATTEMPTS) {
              logger.warn({
                depositId,
                attempts,
                maxAttempts: this.MAX_ATTEMPTS
              }, 'Deposit polling reached maximum attempts');
            }
          }
        } catch (error) {
          logger.error({
            error,
            depositId,
            attempts
          }, 'Error during deposit polling');

          if (attempts >= this.MAX_ATTEMPTS) {
            this.stopPolling(key);
          }
        }
      }, this.POLLING_INTERVAL);

      this.pollingIntervals.set(key, intervalId);
    }, this.INITIAL_DELAY);
  }

  /**
   * Start polling for a transfer transaction
   */
  async startTransferPolling(transferId: string, providerType: string, providerTransactionId: string): Promise<void> {
    const key = `transfer_${transferId}`;

    // Don't start if already polling
    if (this.pollingIntervals.has(key)) {
      logger.info({ transferId, key }, 'Transfer polling already active');
      return;
    }

    // Only poll in sandbox environment
    if (env.NODE_ENV === 'production') {
      logger.info({ transferId }, 'Skipping transfer polling in production - using webhooks');
      return;
    }

    logger.info({
      transferId,
      providerType,
      providerTransactionId
    }, 'Starting transfer auto-polling');

    let attempts = 0;

    // Initial delay before first poll
    setTimeout(() => {
      const intervalId = setInterval(async () => {
        attempts++;

        try {
          const success = await this.pollTransferStatus(transferId, providerType, providerTransactionId, attempts);

          if (success || attempts >= this.MAX_ATTEMPTS) {
            this.stopPolling(key);

            if (!success && attempts >= this.MAX_ATTEMPTS) {
              logger.warn({
                transferId,
                attempts,
                maxAttempts: this.MAX_ATTEMPTS
              }, 'Transfer polling reached maximum attempts');
            }
          }
        } catch (error) {
          logger.error({
            error,
            transferId,
            attempts
          }, 'Error during transfer polling');

          if (attempts >= this.MAX_ATTEMPTS) {
            this.stopPolling(key);
          }
        }
      }, this.POLLING_INTERVAL);

      this.pollingIntervals.set(key, intervalId);
    }, this.INITIAL_DELAY);
  }


  /**
   * Poll deposit status and update database
   */
  private async pollDepositStatus(
    depositId: string,
    providerType: string,
    providerTransactionId: string,
    attempt: number
  ): Promise<boolean> {
    try {
      const provider = ProviderFactory.getProvider(providerType as any);
      if (!provider) {
        logger.error({ providerType, depositId }, 'Provider not found for deposit polling');
        return true; // Stop polling
      }

      // Get current deposit from database
      const deposit = await prisma.deposit.findUnique({
        where: { depositId }
      });

      if (!deposit) {
        logger.error({ depositId }, 'Deposit not found during polling');
        return true; // Stop polling
      }

      // Skip if already completed
      if (deposit.status !== 'PENDING') {
        logger.info({ depositId, status: deposit.status }, 'Deposit already completed, stopping polling');
        return true; // Stop polling
      }

      logger.info({
        depositId,
        providerTransactionId,
        attempt
      }, 'Polling deposit status');

      // Check status with provider
      const statusResponse = await provider.checkDepositStatus(providerTransactionId);

      if (statusResponse.status === DepositStatusEnum.PENDING || statusResponse.status === DepositStatusEnum.PROCESSING) {
        logger.info({
          depositId,
          status: statusResponse.status,
          attempt
        }, 'Deposit still pending, continuing polling');
        return false; // Continue polling
      }

      // Status changed - update deposit with COMPLETE provider response
      const newStatus = statusResponse.status === DepositStatusEnum.COMPLETED ? 'SUCCESSFUL' : 'FAILED';
      const completedAt = new Date();

      // Create complete provider response with both initial and final status
      const currentProviderResponse = (deposit as any).providerResponse || {};
      const updatedProviderResponse = {
        initialResponse: currentProviderResponse, // Preserve original response
        finalStatusResponse: {
          ...statusResponse,
          finalStatus: statusResponse.status,
          finalStatusTimestamp: new Date().toISOString(),
          finalStatusReason: statusResponse.failureReason,
          pollingAttempt: attempt,
          statusCheckTimestamp: new Date().toISOString(),
          providerControlsStatus: true // Flag showing provider controls the final status
        }
      };

      await prisma.deposit.update({
        where: { depositId },
        data: {
          status: newStatus,
          completedAt,
          financialTransactionId: (statusResponse as any).financialTransactionId, // Store provider financial transaction ID when available
          updatedAt: new Date(),
          providerResponse: updatedProviderResponse, // Store COMPLETE provider journey
        } as any
      });

      logger.info({
        depositId,
        oldStatus: deposit.status,
        newStatus,
        attempt
      }, 'Deposit status updated via polling');

      // Note: Webhook queueing handled by deposit service during creation
      // Polling service focuses on status updates only
      logger.info({ depositId, newStatus, attempt }, 'Deposit status updated successfully via auto-polling');

      return true; // Stop polling
    } catch (error) {
      logger.error({
        error,
        depositId,
        attempt
      }, 'Error polling deposit status');
      return false; // Continue polling (might be temporary error)
    }
  }

  /**
   * Poll transfer status and update database
   */
  private async pollTransferStatus(
    transferId: string,
    providerType: string,
    providerTransactionId: string,
    attempt: number
  ): Promise<boolean> {
    try {
      const provider = ProviderFactory.getProvider(providerType as any);
      if (!provider) {
        logger.error({ providerType, transferId }, 'Provider not found for transfer polling');
        return true; // Stop polling
      }

      // Get current transfer from database
      const transfer = await prisma.transfer.findUnique({
        where: { transferId }
      });

      if (!transfer) {
        logger.error({ transferId }, 'Transfer not found during polling');
        return true; // Stop polling
      }

      // Skip if already completed
      if (transfer.status !== 'PENDING' && transfer.status !== 'PROCESSING') {
        logger.info({ transferId, status: transfer.status }, 'Transfer already completed, stopping polling');
        return true; // Stop polling
      }

      logger.info({
        transferId,
        providerTransactionId,
        attempt
      }, 'Polling transfer status');

      // Check status with provider
      const statusResponse = await provider.checkTransferStatus(providerTransactionId);

      if (statusResponse.status === TransferStatusEnum.PENDING || statusResponse.status === TransferStatusEnum.PROCESSING) {
        logger.info({
          transferId,
          status: statusResponse.status,
          attempt
        }, 'Transfer still pending, continuing polling');
        return false; // Continue polling
      }

      // Status changed - update transfer with COMPLETE provider response
      const newStatus = statusResponse.status === TransferStatusEnum.COMPLETED ? 'COMPLETED' : 'FAILED';
      const completedAt = new Date();

      // Create complete provider response with both initial and final status
      const currentProviderResponse = (transfer as any).providerResponse || {};
      const updatedProviderResponse = {
        initialResponse: currentProviderResponse, // Preserve original response
        finalStatusResponse: {
          ...statusResponse,
          finalStatus: statusResponse.status,
          finalStatusTimestamp: new Date().toISOString(),
          finalStatusReason: statusResponse.failureReason,
          pollingAttempt: attempt,
          statusCheckTimestamp: new Date().toISOString(),
          providerControlsStatus: true // Flag showing provider controls the final status
        }
      };

      await prisma.transfer.update({
        where: { transferId },
        data: {
          status: newStatus,
          completedAt,
          financialTransactionId: statusResponse.financialTransactionId, // Store MTN's financial transaction ID
          updatedAt: new Date(),
          providerResponse: updatedProviderResponse, // Store COMPLETE provider journey
        } as any
      });

      logger.info({
        transferId,
        oldStatus: transfer.status,
        newStatus,
        attempt
      }, 'Transfer status updated via polling');

      // Note: Webhook queueing handled by transfer service during creation
      // Polling service focuses on status updates only
      logger.info({ transferId, newStatus, attempt }, 'Transfer status updated successfully via auto-polling');

      return true; // Stop polling
    } catch (error) {
      logger.error({
        error,
        transferId,
        attempt
      }, 'Error polling transfer status');
      return false; // Continue polling (might be temporary error)
    }
  }

  /**
   * Stop polling for a specific key
   */
  private stopPolling(key: string): void {
    const intervalId = this.pollingIntervals.get(key);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(key);
      logger.info({ key }, 'Stopped polling');
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling(): void {
    for (const [, intervalId] of this.pollingIntervals.entries()) {
      clearInterval(intervalId);
    }
    this.pollingIntervals.clear();
    logger.info('Stopped all polling intervals');
  }

  /**
   * Get active polling status
   */
  getActivePolling(): string[] {
    return Array.from(this.pollingIntervals.keys());
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    this.stopAllPolling();
    logger.info('PollingService shutdown complete');
  }
}

// Export singleton instance
export const pollingService = PollingService.getInstance();
