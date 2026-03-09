import { Payment, PaymentStatus, Provider } from '@prisma/client';
import { CreatePaymentInput } from '../utils/validation';
import { logger } from '../utils/logger';
import { prisma } from '../utils/database';
import { ProviderFactory, ProviderMode } from './providers/provider.factory';
import { PaymentRequest } from './providers/provider.interface';
import { AuditService } from './audit.service';
import { WebhookService } from './webhook.service';
import { env } from '../config/env';
import { FeeService } from './fee.service';
import { WalletService } from './wallet.service';

export class PaymentService {
  async createPayment(data: CreatePaymentInput & { provider?: string; providerMode?: string; providerOptions?: any }, apiKeyId: string, mode: ProviderMode = 'SANDBOX'): Promise<Payment> {
    try {
      // Generate transaction ID if not provided
      const transactionId = data.id || `fp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Check for idempotency - if payment with this ID exists, return it
      const existingPayment = await prisma.payment.findUnique({
        where: { transactionId },
      });

      if (existingPayment) {
        logger.info({ transactionId }, 'Idempotent payment request, returning existing payment');
        return existingPayment;
      }

      // Detect provider based on phone number
      const providerType = ProviderFactory.detectProvider(data.from);
      const provider = ProviderFactory.getProvider(providerType, mode);

      if (!provider) {
        throw new Error(`Provider ${providerType} not available`);
      }

      // Get API key owner for fee calculation
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
        select: { userId: true },
      });

      // Calculate fees using database-managed fee structures
      const { fee, commission, netAmount, appliedStructure, percentage } =
        await FeeService.calculateFee(data.amount, apiKey?.userId || '');

      logger.info({
        amount: data.amount,
        fee,
        netAmount,
        feePercentage: percentage,
        appliedStructure,
        userId: apiKey?.userId,
      }, 'Fee calculation for payment');

      // Create payment record in database with userId
      const payment = await prisma.payment.create({
        data: {
          transactionId,
          from: data.from,
          to: data.to,
          amount: data.amount,
          currency: 'XAF', // Set currency
          timestamp: new Date(data.timestamp),
          status: PaymentStatus.PENDING,
          provider: providerType === 'mtn' ? Provider.MTN : Provider.ORANGE,
          apiKeyId,
          userId: apiKey?.userId, // Add direct user ID reference
          fee,
          commission,
          netAmount,
          metadata: {
            providerMode: data.providerMode,
            providerOptions: data.providerOptions,
          } as any,
        },
      });

      // Log payment creation for audit
      await AuditService.logPaymentCreated(payment, apiKey?.userId, {
        provider: providerType,
        apiKeyId,
      });

      // Queue webhook for payment creation
      if (env.WEBHOOK_URL) {
        await WebhookService.queueWebhook(payment.id, 'payment.created', env.WEBHOOK_URL);
      }

      // Process payment with provider asynchronously
      this.processPaymentWithProvider(payment, provider);

      return payment;
    } catch (error: any) {
      if (error.code === 'P2002') {
        // This shouldn't happen due to idempotency check above, but handle it anyway
        const transactionId = data.id || `fp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const existing = await this.getPayment(transactionId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getPayment(transactionId: string): Promise<Payment | null> {
    return prisma.payment.findUnique({
      where: {
        transactionId,
      },
    });
  }

  async getPaymentsByApiKey(apiKeyId: string, limit = 100, offset = 0): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: {
        apiKeyId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });
  }

  private async processPaymentWithProvider(payment: Payment, provider: any): Promise<void> {
    // Process asynchronously after a short delay
    setTimeout(async () => {
      try {
        // Update status to processing
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.PROCESSING },
        });

        await AuditService.logPaymentStatusUpdate(
          payment.id,
          PaymentStatus.PENDING,
          PaymentStatus.PROCESSING
        );

        // Send webhook for status update
        if (env.WEBHOOK_URL) {
          await WebhookService.queueWebhook(payment.id, 'payment.updated', env.WEBHOOK_URL);
        }

        // Prepare payment request for provider
        const paymentRequest: PaymentRequest = {
          transactionId: payment.transactionId,
          from: payment.from,
          to: payment.to,
          amount: payment.amount,
          currency: 'XAF',
          description: `Payment from ${payment.from} to ${payment.to}`,
          // Read providerMode/options from initial metadata if present
          providerMode: (payment as any).metadata?.providerMode,
          providerOptions: (payment as any).metadata?.providerOptions,
        };

        // Initiate payment with provider (supports v2 when providerMode === 'mtn-v2')
        const response = await provider.initiatePayment(paymentRequest);

        if (response.success) {
          // Store provider reference and original request reference in metadata
          const updatedStatus = response.status === 'COMPLETED' ? PaymentStatus.COMPLETED : PaymentStatus.PROCESSING;
          const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              providerReference: response.providerTransactionId, // Store in dedicated field for financial audit
              financialTransactionId: response.financialTransactionId, // Store MTN's financial transaction ID
              metadata: {
                providerReference: response.providerTransactionId, // Keep in metadata for backward compatibility
                originalRequestReference: response.originalRequestReference, // Store original X-Reference-Id for refunds
                // Preserve provider routing for downstream polling
                providerMode: paymentRequest.providerMode,
                providerOptions: paymentRequest.providerOptions,
              },
              status: updatedStatus,
            },
            include: {
              apiKey: {
                select: { userId: true },
              },
            },
          });

          // If completed immediately but financialTransactionId missing, fetch status once
          if (updatedStatus === PaymentStatus.COMPLETED && !updatedPayment.financialTransactionId) {
            try {
              // Choose status API based on providerMode
              const providerMode = (updatedPayment as any).metadata?.providerMode;
              const statusCheck = providerMode === 'mtn-v2'
                ? await provider.checkStatusV2?.(response.providerTransactionId)
                : await provider.checkStatus(response.providerTransactionId);
              if (statusCheck.financialTransactionId) {
                const patched = await prisma.payment.update({
                  where: { id: updatedPayment.id },
                  data: { financialTransactionId: statusCheck.financialTransactionId }
                });
                logger.info({ paymentId: patched.id, finId: patched.financialTransactionId }, 'Captured financialTransactionId on immediate COMPLETED payment');
              }
            } catch (immediateErr) {
              logger.warn({ paymentId: updatedPayment.id, immediateErr }, 'Failed to capture financialTransactionId on immediate COMPLETED payment');
            }
          }

          // If payment is completed, create wallet transaction
          if (updatedStatus === PaymentStatus.COMPLETED && updatedPayment.apiKey?.userId) {
            try {
              await WalletService.processPaymentTransaction(
                updatedPayment.apiKey.userId,
                updatedPayment.provider as Provider,
                updatedPayment.amount,
                updatedPayment.fee || 0,
                updatedPayment.netAmount || updatedPayment.amount,
                updatedPayment.id,
                updatedPayment.transactionId
              );
              logger.info({ paymentId: payment.id }, 'Wallet transaction created for completed payment');
            } catch (walletError) {
              logger.error({ paymentId: payment.id, error: walletError }, 'Failed to create wallet transaction');
              // Don't fail the payment if wallet transaction fails
            }
          }

          // Send webhook for completion
          if (updatedStatus === PaymentStatus.COMPLETED && env.WEBHOOK_URL) {
            await WebhookService.queueWebhook(payment.id, 'payment.completed', env.WEBHOOK_URL);
          }

          // If not immediately completed, poll for status
          if (response.status !== 'COMPLETED') {
            this.pollPaymentStatus(payment.id, provider, response.providerTransactionId);
          }
        } else {
          // Payment initiation failed
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              metadata: { error: response.message },
            },
          });

          // Send webhook for failure
          if (env.WEBHOOK_URL) {
            await WebhookService.queueWebhook(payment.id, 'payment.failed', env.WEBHOOK_URL);
          }
        }

        logger.info({ paymentId: payment.id, success: response.success }, 'Payment processed with provider');
      } catch (error) {
        logger.error({ paymentId: payment.id, error }, 'Error processing payment with provider');
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            metadata: { error: (error as Error).message },
          },
        });
      }
    }, 100);
  }

  private async pollPaymentStatus(paymentId: string, provider: any, providerTransactionId: string): Promise<void> {
    const maxAttempts = 30; // Poll for up to 5 minutes (30 * 10 seconds)
    let attempts = 0;

    const poll = async () => {
      try {
        attempts++;

        // Determine provider mode from stored metadata
        const paymentRow = await prisma.payment.findUnique({ where: { id: paymentId }, select: { metadata: true } });
        const providerMode = (paymentRow as any)?.metadata?.providerMode;
        const status = providerMode === 'mtn-v2' && provider.checkStatusV2
          ? await provider.checkStatusV2(providerTransactionId)
          : await provider.checkStatus(providerTransactionId);

        if (status.status === 'COMPLETED') {
          logger.info({
            paymentId,
            providerTransactionId,
            financialTransactionId: status.financialTransactionId,
            statusObject: status
          }, 'About to update payment with financialTransactionId');

          const completedPayment = await prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.COMPLETED,
              financialTransactionId: status.financialTransactionId, // Store MTN's financial transaction ID
            },
            include: {
              apiKey: {
                select: { userId: true },
              },
            },
          });

          logger.info({
            paymentId,
            providerTransactionId,
            updatedFinancialTransactionId: completedPayment.financialTransactionId
          }, 'Payment completed and updated');

          // Create wallet transaction for completed payment
          if (completedPayment.apiKey?.userId) {
            try {
              await WalletService.processPaymentTransaction(
                completedPayment.apiKey.userId,
                completedPayment.provider as Provider,
                completedPayment.amount,
                completedPayment.fee || 0,
                completedPayment.netAmount || completedPayment.amount,
                completedPayment.id,
                completedPayment.transactionId
              );
              logger.info({ paymentId }, 'Wallet transaction created for polled payment completion');
            } catch (walletError) {
              logger.error({ paymentId, error: walletError }, 'Failed to create wallet transaction on poll completion');
            }
          }

          // Send webhook for completion
          if (env.WEBHOOK_URL) {
            await WebhookService.queueWebhook(paymentId, 'payment.completed', env.WEBHOOK_URL);
          }
          return;
        } else if (status.status === 'FAILED' || status.status === 'CANCELLED') {
          await prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.FAILED,
              financialTransactionId: status.financialTransactionId, // Store MTN's financial transaction ID even for failed payments
              metadata: { failureReason: status.failureReason },
            },
          });
          logger.info({ paymentId, providerTransactionId }, 'Payment failed');

          // Send webhook for failure
          if (env.WEBHOOK_URL) {
            await WebhookService.queueWebhook(paymentId, 'payment.failed', env.WEBHOOK_URL);
          }
          return;
        }

        // Still pending, continue polling if not exceeded max attempts
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000); // Poll every 10 seconds
        } else {
          // Max attempts reached, mark as failed
          await prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentStatus.FAILED,
              metadata: { error: 'Payment timeout - no response from provider' },
            },
          });
          logger.warn({ paymentId, providerTransactionId }, 'Payment polling timeout');
        }
      } catch (error) {
        logger.error({ paymentId, error }, 'Error polling payment status');
        if (attempts >= maxAttempts) {
          await prisma.payment.update({
            where: { id: paymentId },
            data: { status: PaymentStatus.FAILED },
          });
        } else {
          setTimeout(poll, 10000);
        }
      }
    };

    // Start polling after 5 seconds
    setTimeout(poll, 5000);
  }
}
