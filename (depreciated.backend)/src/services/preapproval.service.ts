import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { ProviderFactory } from './providers/provider.factory.ts';
import { PreApprovalRequest, PreApprovalStatusEnum } from './providers/provider.interface.ts';
import { WebhookService } from './webhook.service.ts';
import { v4 as uuidv4 } from 'uuid';

export interface CreatePreApprovalRequest {
  preApprovalId?: string;
  payerPhone: string;
  payerCurrency?: string;
  payerMessage?: string;
  validityTime: number; // In seconds
  provider?: string;
  metadata?: Record<string, any>;
}

export interface PreApprovalServiceResponse {
  success: boolean;
  preApproval?: {
    preApprovalId: string;
    referenceId: string;
    status: string;
    providerReference?: string;
    payerPhone: string;
    payerCurrency: string;
    payerMessage?: string;
    validityTime: number;
    expiresAt: Date;
    createdAt: Date;
    // Raw responses - ALWAYS included
    rawCreateRequest?: any;
    rawCreateResponse?: any;
  };
  error?: string;
}

export class PreApprovalService {
  private getProviderInstance(providerName: string) {
    const normalizedProvider = providerName.toLowerCase() as 'mtn' | 'orange';
    const provider = ProviderFactory.getProvider(normalizedProvider);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    return provider;
  }

  /**
   * Create a new PreApproval
   */
  async createPreApproval(
    apiKeyId: string,
    userId: string | null,
    data: CreatePreApprovalRequest
  ): Promise<PreApprovalServiceResponse> {
    try {
      // Generate IDs
      const preApprovalId = data.preApprovalId || `preapp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const referenceId = uuidv4();

      logger.info({
        preApprovalId,
        referenceId,
        payerPhone: data.payerPhone,
        validityTime: data.validityTime,
        provider: data.provider,
      }, 'Creating PreApproval request');

      // Get provider and initiate PreApproval
      const provider = this.getProviderInstance(data.provider || 'MTN');

      // Check if provider supports PreApproval
      if (!provider.createPreApproval) {
        throw new Error(`Provider ${data.provider || 'MTN'} does not support PreApproval`);
      }

      const preApprovalRequest: PreApprovalRequest = {
        preApprovalId,
        referenceId,
        payerPhone: data.payerPhone,
        payerCurrency: data.payerCurrency || 'XAF',
        payerMessage: data.payerMessage,
        validityTime: data.validityTime,
        metadata: data.metadata || {},
      };

      const providerResponse = await provider.createPreApproval(preApprovalRequest);

      logger.info({
        preApprovalId,
        referenceId,
        status: providerResponse.status,
        providerReference: providerResponse.providerReference,
        success: providerResponse.success,
      }, 'PreApproval processing completed');

      // Calculate expiry time
      const expiresAt = new Date(Date.now() + data.validityTime * 1000);

      // Save PreApproval to database with raw responses
      const savedPreApproval = await (prisma as any).preApproval.create({
        data: {
          preApprovalId,
          referenceId,
          payerPhone: data.payerPhone,
          payerCurrency: data.payerCurrency || 'XAF',
          payerMessage: data.payerMessage,
          validityTime: data.validityTime,
          expiresAt,
          status: providerResponse.status as any,
          provider: (data.provider || 'MTN').toUpperCase() as any,
          providerReference: providerResponse.providerReference,
          metadata: data.metadata || {},
          apiKeyId,
          userId,
          // ALWAYS store raw provider responses
          rawCreateRequest: providerResponse.rawCreateRequest || preApprovalRequest,
          rawCreateResponse: providerResponse.rawCreateResponse || providerResponse,
          approvedAt: providerResponse.status === PreApprovalStatusEnum.APPROVED ? new Date() : null,
        },
      });

      logger.info({
        preApprovalDbId: savedPreApproval.id,
        preApprovalId,
        referenceId,
        status: savedPreApproval.status,
      }, 'PreApproval saved to database with raw responses');

      // Send webhook notifications
      try {
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
            savedPreApproval.id,
            'preapproval.created',
            apiKey.user.settings.webhookUrl
          );
          logger.info({ preApprovalId, webhookUrl: apiKey.user.settings.webhookUrl }, 'PreApproval creation webhook queued');

          // Send status-specific webhooks
          if (providerResponse.status === PreApprovalStatusEnum.APPROVED) {
            await WebhookService.queueWebhook(
              savedPreApproval.id,
              'preapproval.approved',
              apiKey.user.settings.webhookUrl
            );
          } else if (providerResponse.status === PreApprovalStatusEnum.REJECTED) {
            await WebhookService.queueWebhook(
              savedPreApproval.id,
              'preapproval.rejected',
              apiKey.user.settings.webhookUrl
            );
          } else if (providerResponse.status === PreApprovalStatusEnum.FAILED) {
            await WebhookService.queueWebhook(
              savedPreApproval.id,
              'preapproval.failed',
              apiKey.user.settings.webhookUrl
            );
          }
        }
      } catch (webhookError) {
        logger.warn({ webhookError, preApprovalId }, 'Failed to queue PreApproval webhooks');
      }

      return {
        success: providerResponse.success,
        preApproval: {
          preApprovalId,
          referenceId,
          status: providerResponse.status,
          providerReference: providerResponse.providerReference,
          payerPhone: data.payerPhone,
          payerCurrency: data.payerCurrency || 'XAF',
          payerMessage: data.payerMessage,
          validityTime: data.validityTime,
          expiresAt,
          createdAt: savedPreApproval.createdAt,
          rawCreateRequest: savedPreApproval.rawCreateRequest,
          rawCreateResponse: savedPreApproval.rawCreateResponse,
        },
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        preApprovalId: data.preApprovalId,
      }, 'Failed to create PreApproval');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get PreApproval status from provider
   */
  async getPreApprovalStatus(preApprovalId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ preApprovalId, apiKeyId }, 'Getting PreApproval status');

      const preApproval = await (prisma as any).preApproval.findFirst({
        where: {
          preApprovalId,
          apiKeyId,
        },
      });

      if (!preApproval) {
        return {
          success: false,
          error: 'PreApproval not found',
        };
      }

      // Get updated status from provider if we have a reference ID
      if (preApproval.referenceId && preApproval.provider) {
        try {
          const provider = this.getProviderInstance(preApproval.provider);

          if (!provider.getPreApprovalStatus) {
            logger.warn({ provider: preApproval.provider }, 'Provider does not support PreApproval status check');
            return this.returnCachedStatus(preApproval);
          }

          const providerStatus = await provider.getPreApprovalStatus(preApproval.referenceId);

          // Update database with latest status and raw response
          if (providerStatus.status !== preApproval.status) {
            const updateData: any = {
              status: providerStatus.status as any,
              // ALWAYS update raw status response
              rawStatusResponse: providerStatus.rawStatusResponse || providerStatus
            };

            // Set status timestamps
            if (providerStatus.status === PreApprovalStatusEnum.APPROVED && !preApproval.approvedAt) {
              updateData.approvedAt = new Date();
            } else if (providerStatus.status === PreApprovalStatusEnum.CANCELLED && !preApproval.cancelledAt) {
              updateData.cancelledAt = new Date();
            }

            await (prisma as any).preApproval.update({
              where: { id: preApproval.id },
              data: updateData,
            });

            // Send webhook notification for status change
            try {
              const apiKey = await prisma.apiKey.findUnique({
                where: { id: preApproval.apiKeyId },
                include: {
                  user: {
                    include: {
                      settings: true
                    }
                  }
                }
              });

              if (apiKey?.user?.settings?.webhookUrl) {
                const event = this.getWebhookEventForStatus(providerStatus.status);

                await WebhookService.queueWebhook(
                  preApproval.id,
                  event as any,
                  apiKey.user.settings.webhookUrl
                );
                logger.info({ preApprovalId, event, webhookUrl: apiKey.user.settings.webhookUrl }, 'PreApproval status webhook queued');
              }
            } catch (webhookError) {
              logger.warn({ webhookError, preApprovalId }, 'Failed to queue PreApproval status webhook');
            }
          } else if (providerStatus.rawStatusResponse) {
            // Even if status hasn't changed, update raw response
            await (prisma as any).preApproval.update({
              where: { id: preApproval.id },
              data: {
                rawStatusResponse: providerStatus.rawStatusResponse
              },
            });
          }

          return {
            success: true,
            preApprovalId: preApproval.preApprovalId,
            referenceId: preApproval.referenceId,
            providerReference: preApproval.providerReference,
            status: providerStatus.status,
            payerPhone: preApproval.payerPhone,
            expiresAt: preApproval.expiresAt,
            approvedAt: providerStatus.approvedAt || preApproval.approvedAt,
            rejectedAt: providerStatus.rejectedAt,
            expiredAt: providerStatus.expiredAt,
            failureReason: providerStatus.failureReason,
            rawStatusResponse: providerStatus.rawStatusResponse,
            lastUpdated: new Date(),
          };
        } catch (providerError) {
          logger.warn({
            error: (providerError as Error).message,
            preApprovalId,
            referenceId: preApproval.referenceId
          }, 'Failed to get status from provider, returning cached status');

          return this.returnCachedStatus(preApproval);
        }
      }

      return this.returnCachedStatus(preApproval);
    } catch (error: any) {
      logger.error({ error: error.message, preApprovalId }, 'Failed to get PreApproval status');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Cancel a PreApproval
   */
  async cancelPreApproval(preApprovalId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ preApprovalId, apiKeyId }, 'Cancelling PreApproval');

      const preApproval = await (prisma as any).preApproval.findFirst({
        where: {
          preApprovalId,
          apiKeyId,
        },
      });

      if (!preApproval) {
        return {
          success: false,
          error: 'PreApproval not found',
        };
      }

      // Check if already cancelled or in final state
      if (preApproval.status === PreApprovalStatusEnum.CANCELLED) {
        return {
          success: true,
          message: 'PreApproval already cancelled',
          preApprovalId,
          status: PreApprovalStatusEnum.CANCELLED,
        };
      }

      if (preApproval.status === PreApprovalStatusEnum.APPROVED) {
        return {
          success: false,
          error: 'Cannot cancel an approved PreApproval',
        };
      }

      // Cancel with provider
      if (preApproval.referenceId && preApproval.provider) {
        try {
          const provider = this.getProviderInstance(preApproval.provider);

          if (!provider.cancelPreApproval) {
            logger.warn({ provider: preApproval.provider }, 'Provider does not support PreApproval cancellation');
          } else {
            const cancelResponse = await provider.cancelPreApproval(preApproval.referenceId);

            // Update database with cancellation and raw response
            await (prisma as any).preApproval.update({
              where: { id: preApproval.id },
              data: {
                status: PreApprovalStatusEnum.CANCELLED,
                cancelledAt: new Date(),
                // ALWAYS store raw cancel response
                rawCancelResponse: (cancelResponse as any).rawCancelResponse || (cancelResponse as any).rawCreateResponse || cancelResponse,
              },
            });

            // Send webhook notification
            try {
              const apiKey = await prisma.apiKey.findUnique({
                where: { id: preApproval.apiKeyId },
                include: {
                  user: {
                    include: {
                      settings: true
                    }
                  }
                }
              });

              if (apiKey?.user?.settings?.webhookUrl) {
                await WebhookService.queueWebhook(
                  preApproval.id,
                  'preapproval.cancelled',
                  apiKey.user.settings.webhookUrl
                );
              }
            } catch (webhookError) {
              logger.warn({ webhookError, preApprovalId }, 'Failed to queue PreApproval cancellation webhook');
            }

            return {
              success: true,
              message: 'PreApproval cancelled successfully',
              preApprovalId,
              status: PreApprovalStatusEnum.CANCELLED,
              rawCancelResponse: (cancelResponse as any).rawCancelResponse || (cancelResponse as any).rawCreateResponse,
            };
          }
        } catch (providerError) {
          logger.error({
            error: (providerError as Error).message,
            preApprovalId,
          }, 'Failed to cancel with provider, marking as cancelled locally');
        }
      }

      // Mark as cancelled locally even if provider call fails
      await (prisma as any).preApproval.update({
        where: { id: preApproval.id },
        data: {
          status: PreApprovalStatusEnum.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      return {
        success: true,
        message: 'PreApproval cancelled',
        preApprovalId,
        status: PreApprovalStatusEnum.CANCELLED,
      };
    } catch (error: any) {
      logger.error({ error: error.message, preApprovalId }, 'Failed to cancel PreApproval');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get PreApproval by ID
   */
  async getPreApproval(preApprovalId: string, apiKeyId: string): Promise<any> {
    try {
      logger.info({ preApprovalId, apiKeyId }, 'Getting PreApproval details');

      const preApproval = await (prisma as any).preApproval.findFirst({
        where: {
          preApprovalId,
          apiKeyId,
        },
        include: {
          payments: {
            select: {
              id: true,
              transactionId: true,
              amount: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      if (!preApproval) {
        return {
          success: false,
          error: 'PreApproval not found',
        };
      }

      return {
        success: true,
        preApproval: {
          preApprovalId: preApproval.preApprovalId,
          referenceId: preApproval.referenceId,
          status: preApproval.status,
          providerReference: preApproval.providerReference,
          payerPhone: preApproval.payerPhone,
          payerCurrency: preApproval.payerCurrency,
          payerMessage: preApproval.payerMessage,
          validityTime: preApproval.validityTime,
          expiresAt: preApproval.expiresAt,
          provider: preApproval.provider,
          createdAt: preApproval.createdAt,
          updatedAt: preApproval.updatedAt,
          approvedAt: preApproval.approvedAt,
          cancelledAt: preApproval.cancelledAt,
          payments: preApproval.payments,
          metadata: preApproval.metadata,
          // Include raw responses for debugging
          rawCreateRequest: preApproval.rawCreateRequest,
          rawCreateResponse: preApproval.rawCreateResponse,
          rawStatusResponse: preApproval.rawStatusResponse,
          rawCancelResponse: preApproval.rawCancelResponse,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message, preApprovalId }, 'Failed to get PreApproval');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List PreApprovals for an API key
   */
  async listPreApprovals(
    apiKeyId: string,
    page: number = 1,
    limit: number = 10,
    status?: string
  ): Promise<{
    preApprovals: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      logger.info({ apiKeyId, page, limit, status }, 'Listing PreApprovals');

      const offset = (page - 1) * limit;
      const whereClause: any = { apiKeyId };

      if (status) {
        whereClause.status = status;
      }

      const [preApprovals, total] = await Promise.all([
        (prisma as any).preApproval.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
          include: {
            _count: {
              select: { payments: true },
            },
          },
        }),
        (prisma as any).preApproval.count({ where: whereClause }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        preApprovals: preApprovals.map((preApproval: any) => ({
          preApprovalId: preApproval.preApprovalId,
          referenceId: preApproval.referenceId,
          status: preApproval.status,
          providerReference: preApproval.providerReference,
          payerPhone: preApproval.payerPhone,
          payerCurrency: preApproval.payerCurrency,
          validityTime: preApproval.validityTime,
          expiresAt: preApproval.expiresAt,
          provider: preApproval.provider,
          paymentsCount: preApproval._count.payments,
          createdAt: preApproval.createdAt,
          updatedAt: preApproval.updatedAt,
        })),
        total,
        page,
        totalPages,
      };
    } catch (error: any) {
      logger.error({ error: error.message, apiKeyId }, 'Failed to list PreApprovals');
      return {
        preApprovals: [],
        total: 0,
        page,
        totalPages: 0,
      };
    }
  }

  /**
   * Helper to return cached PreApproval status
   */
  private returnCachedStatus(preApproval: any) {
    return {
      success: true,
      preApprovalId: preApproval.preApprovalId,
      referenceId: preApproval.referenceId,
      providerReference: preApproval.providerReference,
      status: preApproval.status,
      payerPhone: preApproval.payerPhone,
      expiresAt: preApproval.expiresAt,
      approvedAt: preApproval.approvedAt,
      cancelledAt: preApproval.cancelledAt,
      failureReason: null,
      rawStatusResponse: preApproval.rawStatusResponse,
      lastUpdated: preApproval.updatedAt,
      cached: true,
    };
  }

  /**
   * Get webhook event name for PreApproval status
   */
  private getWebhookEventForStatus(status: PreApprovalStatusEnum): string {
    switch (status) {
      case PreApprovalStatusEnum.APPROVED:
        return 'preapproval.approved';
      case PreApprovalStatusEnum.REJECTED:
        return 'preapproval.rejected';
      case PreApprovalStatusEnum.EXPIRED:
        return 'preapproval.expired';
      case PreApprovalStatusEnum.CANCELLED:
        return 'preapproval.cancelled';
      case PreApprovalStatusEnum.FAILED:
        return 'preapproval.failed';
      default:
        return 'preapproval.updated';
    }
  }
}

export const preApprovalService = new PreApprovalService();
