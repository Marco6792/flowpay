import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { ProviderFactory, ProviderMode } from './providers/provider.factory';
import { TransferRequest } from './providers/provider.interface';
import { WebhookService } from './webhook.service';
import { pollingService } from './polling.service';

export interface CreateTransferRequest {
  transferId: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

export interface TransferServiceResponse {
  success: boolean;
  transfer?: any;
  rawProviderResponse?: any; // Complete MTN response
  error?: string;
}


export class TransferService {
  private getProviderInstance(providerName: string, mode: ProviderMode = 'SANDBOX') {
    const normalizedProvider = providerName.toLowerCase() as 'mtn' | 'orange';
    const provider = ProviderFactory.getProvider(normalizedProvider, mode);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    return provider;
  }
  /**
   * Create a new transfer
   */
  async createTransfer(
    apiKeyId: string,
    userId: string | null,
    data: CreateTransferRequest,
    mode: ProviderMode = 'SANDBOX'
  ): Promise<TransferServiceResponse> {
    try {
      // Generate transaction ID if not provided
      const transferId = data.transferId || `ft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      logger.info({
        transferId,
        from: data.from,
        to: data.to,
        amount: data.amount,
        provider: data.provider,
      }, 'Creating transfer request');

      // Get provider and initiate transfer (mode-aware)
      const provider = this.getProviderInstance(data.provider || 'MTN', mode);

      const transferRequest: TransferRequest = {
        transferId,
        from: data.from,
        to: data.to,
        amount: data.amount,
        currency: data.currency || 'XAF',
        description: data.description || '',
        metadata: data.metadata || {},
      };

      const providerResponse = await provider.transfer(transferRequest);

      logger.info({
        transferId,
        status: providerResponse.status,
        providerReference: providerResponse.providerTransferId,
        success: providerResponse.success,
        rawResponse: providerResponse,
      }, 'Transfer processing completed');

      // Save transfer to database
      const savedTransfer = await (prisma as any).transfer.create({
        data: {
          transferId,
          from: data.from,
          to: data.to,
          amount: data.amount,
          currency: data.currency || 'XAF',
          description: data.description,
          status: providerResponse.status as any,
          provider: (data.provider || 'MTN').toUpperCase() as any,
          providerReference: providerResponse.providerTransferId,
          financialTransactionId: providerResponse.financialTransactionId, // Store MTN's financial transaction ID
          fee: providerResponse.fee || 0, // Default to 0 if no fee provided
          metadata: data.metadata || {},
          providerResponse: providerResponse, // Store entire raw response for financial audit
          apiKeyId,
          userId: userId, // Link to user
          completedAt: providerResponse.status === 'COMPLETED' ? new Date() : null,
        },
      });

      logger.info({
        transferDbId: savedTransfer.id,
        transferId,
        status: savedTransfer.status,
      }, 'Transfer saved to database');

      // If provider returned COMPLETED immediately but finId missing, fetch status once to capture
      if (providerResponse.status === 'COMPLETED' && !savedTransfer.financialTransactionId && providerResponse.providerTransferId) {
        try {
          const immediateStatus = await provider.checkTransferStatus(providerResponse.providerTransferId);
          if (immediateStatus.financialTransactionId) {
            await (prisma as any).transfer.update({
              where: { id: savedTransfer.id },
              data: { financialTransactionId: immediateStatus.financialTransactionId }
            });
            logger.info({ transferId, finId: immediateStatus.financialTransactionId }, 'Captured financialTransactionId on immediate COMPLETED transfer');
          }
        } catch (immediateErr) {
          logger.warn({ transferId, immediateErr }, 'Failed to capture financialTransactionId on immediate COMPLETED transfer');
        }
      }

      // Start auto-polling for sandbox environment
      if (providerResponse.status === 'PENDING' && providerResponse.providerTransferId) {
        try {
          await pollingService.startTransferPolling(
            transferId,
            (data.provider || 'mtn').toLowerCase(),
            providerResponse.providerTransferId
          );
          logger.info({
            transferId,
            providerReference: providerResponse.providerTransferId,
          }, 'Started auto-polling for transfer');
        } catch (pollingError) {
          logger.warn({
            pollingError,
            transferId,
          }, 'Failed to start transfer polling');
        }
      }

      // Send webhook notifications
      try {
        // Get user settings for webhook URL
        const apiKey = await prisma.apiKey.findUnique({
          where: { id: apiKeyId },
          include: {
            user: {
              include: {
                settings: true
              }
            }
          }
        });

        if (apiKey?.user?.settings?.webhookUrl) {
          // Always send creation webhook
          await WebhookService.queueWebhook(
            savedTransfer.id,
            'transfer.created',
            apiKey.user.settings.webhookUrl
          );
          logger.info({ transferId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Transfer creation webhook queued');

          // If transfer completed immediately, also send completion webhook
          if (providerResponse.status === 'COMPLETED') {
            await WebhookService.queueWebhook(
              savedTransfer.id,
              'transfer.completed',
              apiKey.user.settings.webhookUrl
            );
            logger.info({ transferId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Transfer completion webhook queued');
          } else if (providerResponse.status === 'FAILED') {
            await WebhookService.queueWebhook(
              savedTransfer.id,
              'transfer.failed',
              apiKey.user.settings.webhookUrl
            );
            logger.info({ transferId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Transfer failure webhook queued');
          }
        }
      } catch (webhookError) {
        logger.warn({ webhookError, transferId }, 'Failed to queue transfer webhooks');
      }

      return {
        success: providerResponse.success,
        transfer: {
          transferId,
          status: providerResponse.status,
          providerReference: providerResponse.providerTransferId,
          amount: data.amount,
          currency: data.currency || 'XAF',
          from: data.from,
          to: data.to,
          description: data.description,
          fee: providerResponse.fee,
          createdAt: savedTransfer.createdAt,
        },
        rawProviderResponse: providerResponse, // Complete MTN response
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        transferData: data,
      }, 'Failed to create transfer');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transfer by ID
   */
  async getTransfer(transferId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ transferId, apiKeyId }, 'Getting transfer details');


      const transfer = await (prisma as any).transfer.findFirst({
        where: {
          transferId,
          apiKeyId,
        },
      });

      if (!transfer) {
        return {
          success: false,
          error: 'Transfer not found',
        };
      }

      return {
        success: true,
        transfer: {
          transferId: transfer.transferId,
          status: transfer.status,
          providerReference: transfer.providerReference,
          amount: transfer.amount,
          currency: transfer.currency,
          from: transfer.from,
          to: transfer.to,
          description: transfer.description,
          fee: transfer.fee,
          createdAt: transfer.createdAt,
          updatedAt: transfer.updatedAt,
          completedAt: transfer.completedAt,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message, transferId }, 'Failed to get transfer');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get transfer status from provider
   */
  async getTransferStatus(transferId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ transferId, apiKeyId }, 'Getting transfer status');


      const transfer = await (prisma as any).transfer.findFirst({
        where: {
          transferId,
          apiKeyId,
        },
      });

      if (!transfer) {
        return {
          success: false,
          error: 'Transfer not found',
        };
      }

      // Check if provider has already made final decision via auto-polling
      const hasProviderFinalStatus = transfer.providerResponse &&
        typeof transfer.providerResponse === 'object' &&
        transfer.providerResponse.finalStatusResponse &&
        transfer.providerResponse.finalStatusResponse.providerControlsStatus === true;

      if (hasProviderFinalStatus) {
        // Backfill financialTransactionId if present in provider final status but missing in DB
        try {
          const finId = transfer.providerResponse.finalStatusResponse?.financialTransactionId;
          if (!transfer.financialTransactionId && finId) {
            await (prisma as any).transfer.update({
              where: { id: transfer.id },
              data: { financialTransactionId: finId },
            });
            logger.info({ transferId, finId }, 'Backfilled transfer financialTransactionId from provider final status');
          }
        } catch (backfillError) {
          logger.warn({ transferId, backfillError }, 'Failed to backfill transfer financialTransactionId');
        }

        logger.info({
          transferId,
          currentStatus: transfer.status,
          providerControlled: true
        }, 'Provider has final authority over status - using cached result');

        // Return cached status - provider has final authority
        return {
          success: true,
          transferId: transfer.transferId,
          providerTransferId: transfer.providerReference,
          status: transfer.status, // Use database status (provider-controlled)
          amount: transfer.amount,
          fee: transfer.fee,
          completedAt: transfer.completedAt,
          failureReason: transfer.providerResponse.finalStatusResponse?.finalStatusReason || null,
          financialTransactionId: transfer.providerResponse.finalStatusResponse?.financialTransactionId || transfer.financialTransactionId || null,
          lastUpdated: transfer.updatedAt,
          providerControlled: true, // Flag indicating provider has final authority
        };
      }

      // Only query provider if auto-polling hasn't established final status
      if (transfer.providerReference && transfer.provider) {
        try {
          const provider = this.getProviderInstance(transfer.provider);
          const providerStatus = await provider.checkTransferStatus(transfer.providerReference);

          // Update database with latest status ONLY if not in final state
          if (providerStatus.status !== transfer.status && (transfer.status === 'PENDING' || transfer.status === 'PROCESSING')) {
            const updateData: any = { status: providerStatus.status as any };

            // Set completedAt when status becomes COMPLETED
            if (providerStatus.status === 'COMPLETED' && transfer.completedAt === null) {
              updateData.completedAt = new Date();
            }

            // Store financialTransactionId if provided
            if (providerStatus.financialTransactionId) {
              updateData.financialTransactionId = providerStatus.financialTransactionId;
            }

            // Update providerResponse to indicate this was from status API call
            const currentProviderResponse = transfer.providerResponse || {};
            updateData.providerResponse = {
              ...currentProviderResponse,
              statusApiResponse: {
                ...providerStatus,
                statusApiTimestamp: new Date().toISOString(),
                source: 'status_api_call'
              }
            };

            await (prisma as any).transfer.update({
              where: { id: transfer.id },
              data: updateData,
            });

            // Send webhook notification for status change
            try {
              const apiKey = await prisma.apiKey.findUnique({
                where: { id: transfer.apiKeyId },
                include: {
                  user: {
                    include: {
                      settings: true
                    }
                  }
                }
              });

              if (apiKey?.user?.settings?.webhookUrl) {
                const event = providerStatus.status === 'COMPLETED' ? 'transfer.completed' :
                             providerStatus.status === 'FAILED' ? 'transfer.failed' : 'transfer.updated';

                await WebhookService.queueWebhook(
                  transfer.id,
                  event as any,
                  apiKey.user.settings.webhookUrl
                );
                logger.info({ transferId, event, webhookUrl: apiKey.user.settings.webhookUrl }, 'Transfer status webhook queued');
              }
            } catch (webhookError) {
              logger.warn({ webhookError, transferId }, 'Failed to queue transfer status webhook');
            }
          }

          return {
            success: true,
            transferId: transfer.transferId,
            providerTransferId: transfer.providerReference,
            status: providerStatus.status,
            amount: providerStatus.amount || transfer.amount,
            fee: providerStatus.fee || transfer.fee,
            completedAt: providerStatus.completedAt || (providerStatus.status === 'COMPLETED' ? new Date() : transfer.completedAt),
            failureReason: providerStatus.failureReason,
            financialTransactionId: providerStatus.financialTransactionId,
            lastUpdated: new Date(),
          };
        } catch (providerError) {
          logger.warn({
            error: (providerError as Error).message,
            transferId,
            providerReference: transfer.providerReference
          }, 'Failed to get status from provider, returning cached status');

          return {
            success: true,
            transferId: transfer.transferId,
            providerTransferId: transfer.providerReference,
            status: transfer.status,
            amount: transfer.amount,
            fee: transfer.fee,
            completedAt: transfer.completedAt,
            failureReason: null, // Provider error, so no specific failure reason from MTN
            lastUpdated: transfer.updatedAt,
            cached: true,
          };
        }
      }

      return {
        success: true,
        transferId: transfer.transferId,
        providerTransferId: transfer.providerReference,
        status: transfer.status,
        amount: transfer.amount,
        fee: transfer.fee,
        completedAt: transfer.completedAt,
        failureReason: null, // No provider reference, so no failure reason
        lastUpdated: transfer.updatedAt,
      };
    } catch (error: any) {
      logger.error({ error: error.message, transferId }, 'Failed to get transfer status');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List transfers for an API key
   */
  async listTransfers(
    apiKeyId: string,
    page: number = 1,
    limit: number = 10,
    status?: string
  ): Promise<{
    transfers: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      logger.info({ apiKeyId, page, limit, status }, 'Listing transfers');

      const offset = (page - 1) * limit;
      const whereClause: any = { apiKeyId };

      if (status) {
        whereClause.status = status;
      }

      const [transfers, total] = await Promise.all([
        (prisma as any).transfer.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        (prisma as any).transfer.count({ where: whereClause }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        transfers: transfers.map((transfer: any) => ({
          transferId: transfer.transferId,
          status: transfer.status,
          providerReference: transfer.providerReference,
          amount: transfer.amount,
          currency: transfer.currency,
          from: transfer.from,
          to: transfer.to,
          description: transfer.description,
          fee: transfer.fee,
          provider: transfer.provider,
          createdAt: transfer.createdAt,
          updatedAt: transfer.updatedAt,
        })),
        total,
        page,
        totalPages,
      };
    } catch (error: any) {
      logger.error({ error: error.message, apiKeyId }, 'Failed to list transfers');
      return {
        transfers: [],
        total: 0,
        page,
        totalPages: 0,
      };
    }
  }

  /**
   * Get account balance from provider
   */
  async getBalance(provider: string = 'MTN') {
    try {
      const providerInstance = this.getProviderInstance(provider);
      const balance = await providerInstance.getBalance();

      logger.info({
        provider,
        success: balance.success,
        balanceCount: balance.balances.length,
      }, 'Balance retrieved');

      return balance;
    } catch (error: any) {
      logger.error({ error, provider }, 'Failed to get balance');
      throw error;
    }
  }

  /**
   * Validate recipient account
   */
  async validateRecipient(accountId: string, provider: string = 'MTN') {
    try {
      const providerInstance = this.getProviderInstance(provider);
      const validation = await providerInstance.validateRecipient(accountId, 'MSISDN');

      logger.info({
        accountId,
        provider,
        isActive: validation.isActive,
        success: validation.success,
      }, 'Recipient validation completed');

      return validation;
    } catch (error: any) {
      logger.error({ error, accountId, provider }, 'Failed to validate recipient');
      throw error;
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(accountId: string, provider: string = 'MTN') {
    try {
      const providerInstance = this.getProviderInstance(provider);
      const userInfo = await providerInstance.getUserInfo(accountId, 'MSISDN');

      logger.info({
        accountId,
        provider,
        success: userInfo.success,
        hasUserInfo: !!userInfo.userInfo,
      }, 'User info retrieved');

      return userInfo;
    } catch (error: any) {
      logger.error({ error, accountId, provider }, 'Failed to get user info');
      throw error;
    }
  }

}

export const transferService = new TransferService();
