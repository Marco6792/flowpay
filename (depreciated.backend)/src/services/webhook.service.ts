import { WebhookDelivery, WebhookStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { env } from '../config/env.ts';
import axios from 'axios';
import crypto from 'crypto';
import { AuditService } from './audit.service.ts';

export interface WebhookPayload {
  event: 'payment.created' | 'payment.updated' | 'payment.completed' | 'payment.failed' | 'payment.refunded' |
         'transfer.created' | 'transfer.updated' | 'transfer.completed' | 'transfer.failed' |
         'deposit.created' | 'deposit.updated' | 'deposit.completed' | 'deposit.failed' |
         'withdrawal.created' | 'withdrawal.updated' | 'withdrawal.completed' | 'withdrawal.failed' |
         'preapproval.created' | 'preapproval.approved' | 'preapproval.rejected' | 'preapproval.expired' | 'preapproval.cancelled' | 'preapproval.failed';
  transactionId: string;
  transferId?: string;
  depositId?: string;
  withdrawalId?: string;
  preapprovalId?: string;
  status: PaymentStatus;
  amount?: number;
  from?: string;
  to?: string;
  accountId?: string;
  payerPhone?: string;
  validityTime?: number;
  expiresAt?: string;
  timestamp: string;
  metadata?: any;
}

export class WebhookService {
  private static readonly MAX_RETRIES = 5;
  private static readonly RETRY_DELAYS = [1000, 5000, 15000, 60000, 300000]; // 1s, 5s, 15s, 1m, 5m

  /**
   * Queue a webhook for delivery
   */
  static async queueWebhook(transactionId: string, event: WebhookPayload['event'], webhookUrl: string): Promise<void> {
    try {
      let payload: WebhookPayload;
      let deliveryData: any;

      if (event.startsWith('payment.')) {
        // Get payment details
        const payment = await prisma.payment.findUnique({
          where: { id: transactionId },
        });

        if (!payment) {
          logger.error({ transactionId }, 'Payment not found for webhook');
          return;
        }

        payload = {
          event,
          transactionId: payment.transactionId,
          status: payment.status,
          amount: payment.amount,
          from: payment.from,
          to: payment.to,
          timestamp: payment.timestamp.toISOString(),
          metadata: payment.metadata,
        };

        deliveryData = {
          paymentId: transactionId,
          provider: payment.provider?.toUpperCase() || 'FLOWPAY',
        };
      } else if (event.startsWith('transfer.')) {
        // Get transfer details
        const transfer = await prisma.transfer.findUnique({
          where: { id: transactionId },
        });

        if (!transfer) {
          logger.error({ transactionId }, 'Transfer not found for webhook');
          return;
        }

        payload = {
          event,
          transactionId: transfer.transferId,
          transferId: transfer.transferId,
          status: transfer.status as any,
          amount: transfer.amount,
          from: transfer.from,
          to: transfer.to,
          timestamp: transfer.createdAt.toISOString(),
          metadata: transfer.metadata,
        };

        deliveryData = {
          transferId: transactionId,
          provider: transfer.provider?.toUpperCase() || 'FLOWPAY',
        };
      } else if (event.startsWith('deposit.')) {
        // Get deposit details
        const deposit = await prisma.deposit.findUnique({
          where: { id: transactionId },
        });

        if (!deposit) {
          logger.error({ transactionId }, 'Deposit not found for webhook');
          return;
        }

        payload = {
          event,
          transactionId: deposit.depositId,
          depositId: deposit.depositId,
          status: deposit.status as any,
          amount: deposit.amount,
          accountId: deposit.accountId,
          timestamp: deposit.createdAt.toISOString(),
          metadata: deposit.metadata,
        };

        deliveryData = {
          depositId: transactionId,
          provider: deposit.provider?.toUpperCase() || 'FLOWPAY',
        };
      } else if (event.startsWith('withdrawal.')) {
        // Get withdrawal details
        const withdrawal = await prisma.withdrawal.findUnique({
          where: { id: transactionId },
        });

        if (!withdrawal) {
          logger.error({ transactionId }, 'Withdrawal not found for webhook');
          return;
        }

        payload = {
          event,
          transactionId: withdrawal.withdrawId,
          withdrawalId: withdrawal.withdrawId,
          status: withdrawal.status as any,
          amount: withdrawal.amount,
          accountId: withdrawal.accountId,
          timestamp: withdrawal.createdAt.toISOString(),
          metadata: withdrawal.metadata,
        };

        deliveryData = {
          withdrawalId: transactionId,
          provider: withdrawal.provider?.toUpperCase() || 'FLOWPAY',
        };
      } else if (event.startsWith('preapproval.')) {
        // Get preapproval details
        const preapproval = await prisma.preApproval.findUnique({
          where: { id: transactionId },
        });

        if (!preapproval) {
          logger.error({ transactionId }, 'PreApproval not found for webhook');
          return;
        }

        payload = {
          event,
          transactionId: preapproval.preApprovalId,
          preapprovalId: preapproval.preApprovalId,
          status: preapproval.status as any,
          payerPhone: preapproval.payerPhone,
          validityTime: preapproval.validityTime,
          expiresAt: preapproval.expiresAt?.toISOString(),
          timestamp: preapproval.createdAt.toISOString(),
          metadata: preapproval.metadata,
        };

        deliveryData = {
          preapprovalId: transactionId,
          provider: preapproval.provider?.toUpperCase() || 'FLOWPAY',
        };
      } else {
        logger.error({ event }, 'Unknown webhook event type');
        return;
      }

      // Create webhook delivery record
      const delivery = await prisma.webhookDelivery.create({
        data: {
          ...deliveryData,
          url: webhookUrl,
          status: WebhookStatus.PENDING,
          attempts: 0,
          payload: payload as any,
          providerSignature: this.generateWebhookSignature(payload),
        } as any,
      });

      // Process webhook immediately
      await this.processWebhook(delivery.id);
    } catch (error) {
      logger.error({ error, transactionId, event }, 'Error queuing webhook');
    }
  }

  /**
   * Process a webhook delivery
   */
  static async processWebhook(deliveryId: string): Promise<void> {
    try {
      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id: deliveryId },
      });

      if (!delivery) {
        logger.error({ deliveryId }, 'Webhook delivery not found');
        return;
      }

      // Check if already delivered or max retries reached
      if (delivery.status === WebhookStatus.DELIVERED) {
        return;
      }

      if (delivery.attempts >= this.MAX_RETRIES) {
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: WebhookStatus.FAILED,
            lastError: 'Max retries exceeded',
          } as any,
        });

        await AuditService.log({
          action: 'webhook.failed',
          entityType: 'webhook',
          entityId: deliveryId,
          metadata: {
            url: delivery.url,
            attempts: delivery.attempts,
            error: 'Max retries exceeded',
          },
        });

        return;
      }

      // Increment attempt counter
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: { increment: 1 },
          lastAttempt: new Date(),
        },
      });

      // Generate signature for webhook
      const signature = this.generateWebhookSignature((delivery as any).payload);

      // Send webhook
      try {
        const response = await axios.post(delivery.url, (delivery as any).payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-FlowPay-Signature': signature,
            'X-FlowPay-Event': ((delivery as any).payload as any).event,
          },
          timeout: 30000, // 30 second timeout
        });

        // Mark as delivered if successful (2xx status)
        if (response.status >= 200 && response.status < 300) {
          await prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
              status: WebhookStatus.DELIVERED,
              deliveredAt: new Date(),
              response: response.data || null,
            } as any,
          });

          logger.info({ deliveryId, url: delivery.url }, 'Webhook delivered successfully');

          await AuditService.log({
            action: 'webhook.delivered',
            entityType: 'webhook',
            entityId: deliveryId,
            metadata: {
              url: delivery.url,
              attempts: delivery.attempts + 1,
              status: response.status,
            },
          });
        } else {
          // Non-2xx response, retry
          throw new Error(`Webhook returned status ${response.status}`);
        }
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || error.message || 'Unknown error';

        // Update error information
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            lastError: errorMessage.substring(0, 500),
            status: WebhookStatus.PENDING,
          } as any,
        });

        logger.warn({
          deliveryId,
          url: delivery.url,
          error: errorMessage,
          attempt: delivery.attempts + 1,
        }, 'Webhook delivery failed, will retry');

        // Schedule retry if not at max attempts
        if (delivery.attempts < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAYS[delivery.attempts] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
          setTimeout(() => {
            this.processWebhook(deliveryId);
          }, delay);
        } else {
          // Mark as failed after last attempt
          await prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: { status: WebhookStatus.FAILED },
          });
        }
      }
    } catch (error: any) {
      logger.error({
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        deliveryId
      }, 'Error processing webhook');
    }
  }

  /**
   * Generate a signature for webhook payload
   */
  private static generateWebhookSignature(payload: any): string {
    const secret = env.WEBHOOK_SECRET || 'default_webhook_secret';
    const payloadString = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
  }

  /**
   * Verify webhook signature (for incoming webhooks)
   */
  static verifyWebhookSignature(payload: any, signature: string): boolean {
    const expectedSignature = this.generateWebhookSignature(payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Retry failed webhooks
   */
  static async retryFailedWebhooks(): Promise<void> {
    const failedWebhooks = await prisma.webhookDelivery.findMany({
      where: {
        status: WebhookStatus.FAILED,
        attempts: { lt: this.MAX_RETRIES },
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    logger.info({ count: failedWebhooks.length }, 'Retrying failed webhooks');

    for (const webhook of failedWebhooks) {
      // Reset status and process again
      await prisma.webhookDelivery.update({
        where: { id: webhook.id },
        data: { status: WebhookStatus.PENDING },
      });

      await this.processWebhook(webhook.id);
    }
  }

  /**
   * Get webhook delivery history for a payment
   */
  static async getDeliveryHistory(paymentId: string): Promise<WebhookDelivery[]> {
    return prisma.webhookDelivery.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get webhook delivery history for a transfer
   */
  static async getTransferDeliveryHistory(transferId: string): Promise<WebhookDelivery[]> {
    return prisma.webhookDelivery.findMany({
      where: { transferId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get webhook delivery history for a deposit
   */
  static async getDepositDeliveryHistory(depositId: string): Promise<WebhookDelivery[]> {
    return prisma.webhookDelivery.findMany({
      where: { depositId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get webhook delivery history for a preapproval
   */
  static async getPreApprovalDeliveryHistory(preapprovalId: string): Promise<WebhookDelivery[]> {
    return prisma.webhookDelivery.findMany({
      where: { preapprovalId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Clean up old webhook deliveries
   */
  static async cleanupOldDeliveries(daysToKeep = 30): Promise<void> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    const result = await prisma.webhookDelivery.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: { in: [WebhookStatus.DELIVERED, WebhookStatus.FAILED] },
      },
    });

    logger.info({ deleted: result.count }, 'Cleaned up old webhook deliveries');
  }
}
