import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { ProviderFactory } from './providers/provider.factory.ts';
import { WithdrawRequest } from './providers/provider.interface.ts';
import { WebhookService } from './webhook.service.ts';

export interface CreateWithdrawalRequest {
  withdrawId: string;
  accountId: string;
  amount: number;
  currency: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

export interface WithdrawalServiceResponse {
  success: boolean;
  withdrawal?: {
    withdrawId: string;
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

export class WithdrawalService {
  private getProviderInstance(providerName: string) {
    const normalizedProvider = providerName.toLowerCase() as 'mtn' | 'orange';
    const provider = ProviderFactory.getProvider(normalizedProvider);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    return provider;
  }

  /**
   * Create a new withdrawal
   */
  async createWithdrawal(
    apiKeyId: string,
    userId: string | null,
    data: CreateWithdrawalRequest
  ): Promise<WithdrawalServiceResponse> {
    try {
      // Generate withdrawal ID if not provided
      const withdrawId = data.withdrawId || `wd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      logger.info({
        withdrawId,
        accountId: data.accountId,
        amount: data.amount,
        provider: data.provider,
      }, 'Creating withdrawal request');

      // Get provider and initiate withdrawal
      const provider = this.getProviderInstance(data.provider || 'MTN');

      const withdrawRequest: WithdrawRequest = {
        withdrawId,
        from: data.accountId, // FlowPay test number (will be mapped by provider)
        amount: data.amount,
        currency: data.currency || 'XAF',
        description: data.description || '',
        payerMessage: 'Withdrawal request from FlowPay',
      };

      const providerResponse = await provider.requestWithdraw(withdrawRequest);

      logger.info({
        withdrawId,
        status: providerResponse.status,
        providerReference: providerResponse.providerWithdrawId,
        success: providerResponse.success,
        rawResponse: providerResponse,
      }, 'Withdrawal processing completed');

      // Save withdrawal to database
      const savedWithdrawal = await (prisma as any).withdrawal.create({
        data: {
          withdrawId,
          accountId: data.accountId,
          amount: data.amount,
          currency: data.currency || 'XAF',
          description: data.description,
          status: providerResponse.status as any,
          provider: (data.provider || 'MTN').toUpperCase() as any,
          providerReference: providerResponse.providerWithdrawId || providerResponse.referenceId,
          financialTransactionId: providerResponse.financialTransactionId, // Store MTN's financial transaction ID (initially null)
          fee: providerResponse.fee || 0, // Default to 0 if no fee provided
          metadata: data.metadata || {},
          rawCreateRequest: withdrawRequest, // Store request for audit
          rawCreateResponse: providerResponse, // Store entire raw response for financial audit
          apiKeyId,
          userId: userId, // Link to user
          completedAt: providerResponse.status === 'COMPLETED' ? new Date() : null,
        },
      });

      logger.info({
        withdrawalDbId: savedWithdrawal.id,
        withdrawId,
        status: savedWithdrawal.status,
      }, 'Withdrawal saved to database');

      // If provider returned COMPLETED immediately, fetch status to capture financialTransactionId
      if (providerResponse.status === 'COMPLETED' && (providerResponse as any).providerWithdrawId) {
        try {
          const immediateStatus = await provider.checkWithdrawStatus((providerResponse as any).providerWithdrawId);
          if (immediateStatus.financialTransactionId) {
            await (prisma as any).withdrawal.update({
              where: { id: savedWithdrawal.id },
              data: { financialTransactionId: immediateStatus.financialTransactionId }
            });
            logger.info({ withdrawId, finId: immediateStatus.financialTransactionId }, 'Captured financialTransactionId on immediate COMPLETED withdrawal');
          }
        } catch (immediateErr) {
          logger.warn({ withdrawId, immediateErr }, 'Failed to capture financialTransactionId on immediate COMPLETED withdrawal');
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
            savedWithdrawal.id,
            'withdrawal.created',
            apiKey.user.settings.webhookUrl
          );
          logger.info({ withdrawId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Withdrawal creation webhook queued');

          // If withdrawal completed immediately, also send completion webhook
          if (providerResponse.status === 'COMPLETED') {
            await WebhookService.queueWebhook(
              savedWithdrawal.id,
              'withdrawal.completed',
              apiKey.user.settings.webhookUrl
            );
            logger.info({ withdrawId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Withdrawal completion webhook queued');
          } else if (providerResponse.status === 'FAILED') {
            await WebhookService.queueWebhook(
              savedWithdrawal.id,
              'withdrawal.failed',
              apiKey.user.settings.webhookUrl
            );
            logger.info({ withdrawId, webhookUrl: apiKey.user.settings.webhookUrl }, 'Withdrawal failure webhook queued');
          }
        }
      } catch (webhookError) {
        logger.warn({ webhookError, withdrawId }, 'Failed to queue withdrawal webhooks');
      }

      return {
        success: providerResponse.success,
        withdrawal: {
          withdrawId,
          status: providerResponse.status,
          providerReference: providerResponse.providerWithdrawId || providerResponse.referenceId,
          amount: data.amount,
          currency: data.currency || 'XAF',
          accountId: data.accountId,
          description: data.description,
          fee: providerResponse.fee,
          createdAt: savedWithdrawal.createdAt,
        },
        rawProviderResponse: providerResponse, // Complete MTN response
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        withdrawalData: data,
      }, 'Failed to create withdrawal');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get withdrawal status from provider
   */
  async getWithdrawalStatus(withdrawId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ withdrawId, apiKeyId }, 'Getting withdrawal status');

      const withdrawal = await (prisma as any).withdrawal.findFirst({
        where: {
          withdrawId,
          apiKeyId,
        },
      });

      if (!withdrawal) {
        return {
          success: false,
          error: 'Withdrawal not found',
        };
      }

      // Get updated status from provider if we have a provider reference
      if (withdrawal.providerReference && withdrawal.provider) {
        try {
          const provider = this.getProviderInstance(withdrawal.provider);
          const providerStatus = await provider.checkWithdrawStatus(withdrawal.providerReference);

          // Update database with latest status
          if (providerStatus.status !== withdrawal.status) {
            const updateData: any = { status: providerStatus.status as any };

            // Set completedAt when status becomes COMPLETED
            if (providerStatus.status === 'COMPLETED' && withdrawal.completedAt === null) {
              updateData.completedAt = new Date();
            }

            // Store financialTransactionId if provided
            if (providerStatus.financialTransactionId) {
              updateData.financialTransactionId = providerStatus.financialTransactionId;
            }

            // Update rawStatusResponse with latest status
            updateData.rawStatusResponse = providerStatus;

            await (prisma as any).withdrawal.update({
              where: { id: withdrawal.id },
              data: updateData,
            });

            // Send webhook notification for status change
            try {
              const apiKey = await prisma.apiKey.findUnique({
                where: { id: withdrawal.apiKeyId },
                include: {
                  user: {
                    include: {
                      settings: true
                    }
                  }
                }
              });

              if (apiKey?.user?.settings?.webhookUrl) {
                const event = providerStatus.status === 'COMPLETED' ? 'withdrawal.completed' :
                             providerStatus.status === 'FAILED' ? 'withdrawal.failed' : 'withdrawal.updated';

                await WebhookService.queueWebhook(
                  withdrawal.id,
                  event as any,
                  apiKey.user.settings.webhookUrl
                );
                logger.info({ withdrawId, event, webhookUrl: apiKey.user.settings.webhookUrl }, 'Withdrawal status webhook queued');
              }
            } catch (webhookError) {
              logger.warn({ webhookError, withdrawId }, 'Failed to queue withdrawal status webhook');
            }
          }

          // Backfill financialTransactionId even if status didn't change
          if (!withdrawal.financialTransactionId && providerStatus.financialTransactionId) {
            try {
              await (prisma as any).withdrawal.update({
                where: { id: withdrawal.id },
                data: { financialTransactionId: providerStatus.financialTransactionId }
              });
              withdrawal.financialTransactionId = providerStatus.financialTransactionId as any;
              logger.info({ withdrawId, finId: providerStatus.financialTransactionId }, 'Backfilled withdrawal financialTransactionId from provider status');
            } catch (bfError) {
              logger.warn({ withdrawId, bfError }, 'Failed to backfill withdrawal financialTransactionId');
            }
          }

          return {
            success: true,
            withdrawId: withdrawal.withdrawId,
            providerWithdrawId: withdrawal.providerReference,
            status: providerStatus.status,
            amount: providerStatus.amount || withdrawal.amount,
            currency: withdrawal.currency,
            accountId: withdrawal.accountId,
            fee: providerStatus.fee || withdrawal.fee,
            completedAt: providerStatus.completedAt || (providerStatus.status === 'COMPLETED' ? new Date() : withdrawal.completedAt),
            failureReason: providerStatus.failureReason,
            financialTransactionId: providerStatus.financialTransactionId,
            lastUpdated: new Date(),
          };
        } catch (providerError) {
          logger.warn({
            error: (providerError as Error).message,
            withdrawId,
            providerReference: withdrawal.providerReference
          }, 'Failed to get status from provider, returning cached status');

          return {
            success: true,
            withdrawId: withdrawal.withdrawId,
            providerWithdrawId: withdrawal.providerReference,
            status: withdrawal.status,
            amount: withdrawal.amount,
            currency: withdrawal.currency,
            accountId: withdrawal.accountId,
            fee: withdrawal.fee,
            completedAt: withdrawal.completedAt,
            failureReason: null,
            lastUpdated: withdrawal.updatedAt,
            cached: true,
          };
        }
      }

      return {
        success: true,
        withdrawId: withdrawal.withdrawId,
        providerWithdrawId: withdrawal.providerReference,
        status: withdrawal.status,
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        accountId: withdrawal.accountId,
        fee: withdrawal.fee,
        completedAt: withdrawal.completedAt,
        failureReason: null,
        lastUpdated: withdrawal.updatedAt,
      };
    } catch (error: any) {
      logger.error({ error: error.message, withdrawId }, 'Failed to get withdrawal status');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get withdrawal by ID
   */
  async getWithdrawal(withdrawId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ withdrawId, apiKeyId }, 'Getting withdrawal details');

      const withdrawal = await (prisma as any).withdrawal.findFirst({
        where: {
          withdrawId,
          apiKeyId,
        },
      });

      if (!withdrawal) {
        return {
          success: false,
          error: 'Withdrawal not found',
        };
      }

      return {
        success: true,
        withdrawal: {
          withdrawId: withdrawal.withdrawId,
          status: withdrawal.status,
          providerReference: withdrawal.providerReference,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          accountId: withdrawal.accountId,
          description: withdrawal.description,
          fee: withdrawal.fee,
          createdAt: withdrawal.createdAt,
          updatedAt: withdrawal.updatedAt,
          completedAt: withdrawal.completedAt,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message, withdrawId }, 'Failed to get withdrawal');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List withdrawals for an API key
   */
  async listWithdrawals(
    apiKeyId: string,
    page: number = 1,
    limit: number = 10,
    status?: string
  ): Promise<{
    withdrawals: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      logger.info({ apiKeyId, page, limit, status }, 'Listing withdrawals');

      const offset = (page - 1) * limit;
      const whereClause: any = { apiKeyId };

      if (status) {
        whereClause.status = status;
      }

      const [withdrawals, total] = await Promise.all([
        (prisma as any).withdrawal.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        (prisma as any).withdrawal.count({ where: whereClause }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        withdrawals: withdrawals.map((withdrawal: any) => ({
          withdrawId: withdrawal.withdrawId,
          status: withdrawal.status,
          providerReference: withdrawal.providerReference,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          accountId: withdrawal.accountId,
          description: withdrawal.description,
          fee: withdrawal.fee,
          provider: withdrawal.provider,
          createdAt: withdrawal.createdAt,
          updatedAt: withdrawal.updatedAt,
          completedAt: withdrawal.completedAt,
        })),
        total,
        page,
        totalPages,
      };
    } catch (error: any) {
      logger.error({ error: error.message, apiKeyId }, 'Failed to list withdrawals');
      return {
        withdrawals: [],
        total: 0,
        page,
        totalPages: 0,
      };
    }
  }
}

export const withdrawalService = new WithdrawalService();
