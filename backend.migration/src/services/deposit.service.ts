import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { ProviderFactory, ProviderMode } from './providers/provider.factory';
import { DepositRequest } from './providers/provider.interface';
import { WebhookService } from './webhook.service';
import { pollingService } from './polling.service';

export interface CreateDepositRequest {
  depositId: string;
  accountId: string;
  amount: number;
  currency: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

export interface DepositServiceResponse {
  success: boolean;
  deposit?: {
    depositId: string;
    status: string;
    providerReference?: string;
    amount: number;
    currency: string;
    accountId: string;
    description?: string;
    fee?: number;
    createdAt: Date;
  };
  rawProviderResponse?: any; // Complete MTN response
  error?: string;
}

export class DepositService {
  private getProviderInstance(providerName: string, mode: ProviderMode = 'SANDBOX') {
    const normalizedProvider = providerName.toLowerCase() as 'mtn' | 'orange';
    const provider = ProviderFactory.getProvider(normalizedProvider, mode);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    return provider;
  }

  /**
   * Create a new deposit
   */
  async createDeposit(
    apiKeyId: string,
    userId: string | null,
    data: CreateDepositRequest,
    mode: ProviderMode = 'SANDBOX'
  ): Promise<DepositServiceResponse> {
    try {
      // Generate deposit ID if not provided
      const depositId = data.depositId || `dep_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      logger.info({
        depositId,
        accountId: data.accountId,
        amount: data.amount,
        provider: data.provider,
        mode,
      }, 'Creating deposit request');

      // Get provider and initiate deposit (mode-aware)
      const provider = this.getProviderInstance(data.provider || 'MTN', mode);

      const depositRequest: DepositRequest = {
        depositId,
        accountId: data.accountId,
        amount: data.amount,
        currency: data.currency || 'XAF',
        description: data.description || '',
        metadata: data.metadata || {},
      };

      const providerResponse = await provider.deposit(depositRequest);

      logger.info({
        depositId,
        status: providerResponse.status,
        providerReference: providerResponse.providerDepositId,
        success: providerResponse.success,
        rawResponse: providerResponse,
      }, 'Deposit processing completed');

      // Save deposit to database
      const savedDeposit = await (prisma as any).deposit.create({
        data: {
          depositId,
          accountId: data.accountId,
          amount: data.amount,
          currency: data.currency || 'XAF',
          description: data.description,
          status: providerResponse.status as any,
          provider: (data.provider || 'MTN').toUpperCase() as any,
          providerReference: providerResponse.providerDepositId,
          fee: providerResponse.fee || 0, // Default to 0 if no fee provided
          metadata: data.metadata || {},
          providerResponse: providerResponse, // Store entire raw response for financial audit
          apiKeyId,
          userId: userId, // Link to user
          completedAt: providerResponse.status === 'COMPLETED' ? new Date() : null,
        },
      });

      logger.info({
        depositDbId: savedDeposit.id,
        depositId,
        status: savedDeposit.status,
      }, 'Deposit saved to database');

      // If provider returned COMPLETED immediately, fetch status to capture financialTransactionId
      if (providerResponse.status === 'COMPLETED' && providerResponse.providerDepositId) {
        try {
          const immediateStatus = await provider.checkDepositStatus(providerResponse.providerDepositId);
          if (immediateStatus.financialTransactionId) {
            await (prisma as any).deposit.update({
              where: { id: savedDeposit.id },
              data: { financialTransactionId: immediateStatus.financialTransactionId }
            });
            logger.info({ depositId, finId: immediateStatus.financialTransactionId }, 'Captured financialTransactionId on immediate COMPLETED deposit');
          }
        } catch (immediateErr) {
          logger.warn({ depositId, immediateErr }, 'Failed to capture financialTransactionId on immediate COMPLETED deposit');
        }
      }

      // Start auto-polling for sandbox environment
      if (providerResponse.status === 'PENDING' && providerResponse.providerDepositId) {
        try {
          await pollingService.startDepositPolling(
            depositId,
            (data.provider || 'mtn').toLowerCase(),
            providerResponse.providerDepositId
          );
          logger.info({
            depositId,
            providerReference: providerResponse.providerDepositId,
          }, 'Started auto-polling for deposit');
        } catch (pollingError) {
          logger.warn({
            pollingError,
            depositId,
          }, 'Failed to start deposit polling');
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
            savedDeposit.id,
            'deposit.created',
            apiKey.user.settings.webhookUrl
          );
          logger.info({ depositId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Deposit creation webhook queued');

          // If deposit completed immediately, also send completion webhook
          if (providerResponse.status === 'COMPLETED') {
            await WebhookService.queueWebhook(
              savedDeposit.id,
              'deposit.completed',
              apiKey.user.settings.webhookUrl
            );
            logger.info({ depositId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Deposit completion webhook queued');
          } else if (providerResponse.status === 'FAILED') {
            await WebhookService.queueWebhook(
              savedDeposit.id,
              'deposit.failed',
              apiKey.user.settings.webhookUrl
            );
            logger.info({ depositId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Deposit failure webhook queued');
          }
        }
      } catch (webhookError) {
        logger.warn({ webhookError, depositId }, 'Failed to queue deposit webhooks');
      }

      return {
        success: providerResponse.success,
        deposit: {
          depositId,
          status: providerResponse.status,
          providerReference: providerResponse.providerDepositId,
          amount: data.amount,
          currency: data.currency || 'XAF',
          accountId: data.accountId,
          description: data.description,
          fee: providerResponse.fee,
          createdAt: savedDeposit.createdAt,
        },
        rawProviderResponse: providerResponse, // Complete MTN response
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        depositId: data.depositId,
      }, 'Failed to create deposit');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get deposit status from provider
   */
  async getDepositStatus(depositId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ depositId, apiKeyId }, 'Getting deposit status');

      const deposit = await (prisma as any).deposit.findFirst({
        where: {
          depositId,
          apiKeyId,
        },
      });

      if (!deposit) {
        return {
          success: false,
          error: 'Deposit not found',
        };
      }

      // Check if provider has already made final decision via auto-polling
      const hasProviderFinalStatus = deposit.providerResponse &&
        typeof deposit.providerResponse === 'object' &&
        deposit.providerResponse.finalStatusResponse &&
        deposit.providerResponse.finalStatusResponse.providerControlsStatus === true;

      if (hasProviderFinalStatus) {
        // If DB is missing financialTransactionId but provider final response has it, backfill it
        try {
          const finId = deposit.providerResponse.finalStatusResponse?.financialTransactionId;
          if (!deposit.financialTransactionId && finId) {
            await (prisma as any).deposit.update({
              where: { id: deposit.id },
              data: { financialTransactionId: finId },
            });
            logger.info({ depositId, finId }, 'Backfilled financialTransactionId from provider final status');
          }
        } catch (backfillError) {
          logger.warn({ depositId, backfillError }, 'Failed to backfill financialTransactionId');
        }

        logger.info({
          depositId,
          currentStatus: deposit.status,
          providerControlled: true
        }, 'Provider has final authority over status - using cached result');

        // Return cached status - provider has final authority
        return {
          success: true,
          depositId: deposit.depositId,
          providerDepositId: deposit.providerReference,
          status: deposit.status, // Use database status (provider-controlled)
          amount: deposit.amount,
          currency: deposit.currency,
          accountId: deposit.accountId,
          fee: deposit.fee,
          completedAt: deposit.completedAt,
          failureReason: deposit.providerResponse.finalStatusResponse?.finalStatusReason || null,
          financialTransactionId: deposit.providerResponse.finalStatusResponse?.financialTransactionId || null,
          lastUpdated: deposit.updatedAt,
          providerControlled: true, // Flag indicating provider has final authority
        };
      }

      // Only query provider if auto-polling hasn't established final status
      if (deposit.providerReference && deposit.provider) {
        try {
          const provider = this.getProviderInstance(deposit.provider);
          const providerStatus = await provider.checkDepositStatus(deposit.providerReference);

          // Update database with latest status ONLY if not in final state
          if (providerStatus.status !== deposit.status && deposit.status === 'PENDING') {
            const updateData: any = { status: providerStatus.status as any };

            // Set completedAt when status becomes SUCCESSFUL (database uses SUCCESSFUL, provider uses COMPLETED)
            if ((providerStatus.status as string === 'SUCCESSFUL' || providerStatus.status === 'COMPLETED') && deposit.completedAt === null) {
              updateData.completedAt = new Date();
            }

            // Persist provider financialTransactionId when available
            if (providerStatus.financialTransactionId) {
              updateData.financialTransactionId = providerStatus.financialTransactionId;
            }

            // Update providerResponse to indicate this was from status API call
            const currentProviderResponse = deposit.providerResponse || {};
            updateData.providerResponse = {
              ...currentProviderResponse,
              statusApiResponse: {
                ...providerStatus,
                statusApiTimestamp: new Date().toISOString(),
                source: 'status_api_call'
              }
            };

            await (prisma as any).deposit.update({
              where: { id: deposit.id },
              data: updateData,
            });

            // Send webhook notification for status change
            try {
              const apiKey = await prisma.apiKey.findUnique({
                where: { id: deposit.apiKeyId },
                include: {
                  user: {
                    include: {
                      settings: true
                    }
                  }
                }
              });

              if (apiKey?.user?.settings?.webhookUrl) {
                const event = (providerStatus.status as string === 'SUCCESSFUL' || providerStatus.status === 'COMPLETED') ? 'deposit.completed' :
                             providerStatus.status === 'FAILED' ? 'deposit.failed' : 'deposit.updated';

                await WebhookService.queueWebhook(
                  deposit.id,
                  event as any,
                  apiKey.user.settings.webhookUrl
                );
                logger.info({ depositId, event, webhookUrl: apiKey.user.settings.webhookUrl }, 'Deposit status webhook queued');
              }
            } catch (webhookError) {
              logger.warn({ webhookError, depositId }, 'Failed to queue deposit status webhook');
            }
          }

          return {
            success: true,
            depositId: deposit.depositId,
            providerDepositId: deposit.providerReference,
            status: providerStatus.status,
            amount: providerStatus.amount || deposit.amount,
            currency: deposit.currency,
            accountId: deposit.accountId,
            fee: providerStatus.fee || deposit.fee,
            completedAt: providerStatus.completedAt || ((providerStatus.status as string === 'SUCCESSFUL' || providerStatus.status === 'COMPLETED') ? new Date() : deposit.completedAt),
            failureReason: providerStatus.failureReason,
            financialTransactionId: providerStatus.financialTransactionId,
            lastUpdated: new Date(),
          };
        } catch (providerError) {
          logger.warn({
            error: (providerError as Error).message,
            depositId,
            providerReference: deposit.providerReference
          }, 'Failed to get status from provider, returning cached status');

          return {
            success: true,
            depositId: deposit.depositId,
            providerDepositId: deposit.providerReference,
            status: deposit.status,
            amount: deposit.amount,
            currency: deposit.currency,
            accountId: deposit.accountId,
            fee: deposit.fee,
            completedAt: deposit.completedAt,
            failureReason: null,
            lastUpdated: deposit.updatedAt,
            cached: true,
          };
        }
      }

      return {
        success: true,
        depositId: deposit.depositId,
        providerDepositId: deposit.providerReference,
        status: deposit.status,
        amount: deposit.amount,
        currency: deposit.currency,
        accountId: deposit.accountId,
        fee: deposit.fee,
        completedAt: deposit.completedAt,
        failureReason: null,
        lastUpdated: deposit.updatedAt,
      };
    } catch (error: any) {
      logger.error({ error: error.message, depositId }, 'Failed to get deposit status');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get deposit by ID
   */
  async getDeposit(depositId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ depositId, apiKeyId }, 'Getting deposit details');

      const deposit = await (prisma as any).deposit.findFirst({
        where: {
          depositId,
          apiKeyId,
        },
      });

      if (!deposit) {
        return {
          success: false,
          error: 'Deposit not found',
        };
      }

      return {
        success: true,
        deposit: {
          depositId: deposit.depositId,
          status: deposit.status,
          providerReference: deposit.providerReference,
          amount: deposit.amount,
          currency: deposit.currency,
          accountId: deposit.accountId,
          description: deposit.description,
          fee: deposit.fee,
          createdAt: deposit.createdAt,
          updatedAt: deposit.updatedAt,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message, depositId }, 'Failed to get deposit');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List deposits for an API key
   */
  async listDeposits(
    apiKeyId: string,
    page: number = 1,
    limit: number = 10,
    status?: string
  ): Promise<{
    deposits: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      logger.info({ apiKeyId, page, limit, status }, 'Listing deposits');

      const offset = (page - 1) * limit;
      const whereClause: any = { apiKeyId };

      if (status) {
        whereClause.status = status;
      }

      const [deposits, total] = await Promise.all([
        (prisma as any).deposit.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        (prisma as any).deposit.count({ where: whereClause }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        deposits: deposits.map((deposit: any) => ({
          depositId: deposit.depositId,
          status: deposit.status,
          providerReference: deposit.providerReference,
          amount: deposit.amount,
          currency: deposit.currency,
          accountId: deposit.accountId,
          description: deposit.description,
          fee: deposit.fee,
          provider: deposit.provider,
          createdAt: deposit.createdAt,
          updatedAt: deposit.updatedAt,
        })),
        total,
        page,
        totalPages,
      };
    } catch (error: any) {
      logger.error({ error: error.message, apiKeyId }, 'Failed to list deposits');
      return {
        deposits: [],
        total: 0,
        page,
        totalPages: 0,
      };
    }
  }
}

export const depositService = new DepositService();
