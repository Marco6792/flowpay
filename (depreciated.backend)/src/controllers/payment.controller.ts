import { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentService } from '../services/payment.service.ts';
import { withdrawalService } from '../services/withdrawal.service.ts';
import { CreatePaymentInput } from '../utils/validation.ts';
import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { PaymentStatus, RefundStatus, WithdrawalStatus, Prisma } from '@prisma/client';
import { MTNMobileMoneyProvider } from '../services/providers/mtn.provider.ts';
import { ProviderFactory } from '../services/providers/provider.factory.ts';
import { RefundErrorService } from '../services/refund-error.service.ts';
import { RefundRetryJob } from '../jobs/refund-retry.job.ts';

export class PaymentController {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  /**
   * Create a new payment
   */
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const paymentData = request.body as CreatePaymentInput;
      const apiKeyId = request.apiKey?.id;

      if (!apiKeyId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key required',
        });
      }

      // Persist provider routing info into metadata via PaymentService
      const payment = await this.paymentService.createPayment(paymentData as any, apiKeyId);

      return reply.status(201).send({
        id: payment.id,
        transactionId: payment.transactionId,
        status: payment.status,
        amount: payment.amount,
        from: payment.from,
        to: payment.to,
        currency: payment.currency,
        timestamp: payment.timestamp.toISOString(),
        createdAt: payment.createdAt.toISOString(),
        financialTransactionId: payment.financialTransactionId, // Include MTN's financial transaction ID
      });
    } catch (error: any) {
      logger.error({ error }, 'Error creating payment');

      if (error.code === 'P2002') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Payment with this transaction ID already exists',
        });
      }

      throw error;
    }
  }

  /**
   * Get payment by transaction ID
   */
  async getByTransactionId(request: FastifyRequest, reply: FastifyReply) {
    const { transactionId } = request.params as { transactionId: string };
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        transactionId,
        apiKeyId,
      },
    });

    if (!payment) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    return {
      id: payment.id,
      transactionId: payment.transactionId,
      status: payment.status,
      amount: payment.amount,
      from: payment.from,
      to: payment.to,
      currency: payment.currency,
      provider: payment.provider,
      timestamp: payment.timestamp.toISOString(),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      financialTransactionId: payment.financialTransactionId, // Include MTN's financial transaction ID
      metadata: payment.metadata,
    };
  }

  /**
   * List payments
   */
  async list(request: FastifyRequest, reply: FastifyReply) {
    const apiKeyId = request.apiKey?.id;
    const query = request.query as {
      limit?: string;
      offset?: string;
      status?: PaymentStatus;
      from?: string;
      to?: string;
      startDate?: string;
      endDate?: string;
    };

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    const limit = parseInt(query.limit || '100', 10);
    const offset = parseInt(query.offset || '0', 10);

    const where: any = { apiKeyId };

    if (query.status) where.status = query.status;
    if (query.from) where.from = query.from;
    if (query.to) where.to = query.to;

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments: payments.map(payment => ({
        id: payment.id,
        transactionId: payment.transactionId,
        status: payment.status,
        amount: payment.amount,
        from: payment.from,
        to: payment.to,
        currency: payment.currency,
        provider: payment.provider,
        timestamp: payment.timestamp.toISOString(),
        createdAt: payment.createdAt.toISOString(),
        financialTransactionId: payment.financialTransactionId, // Include MTN's financial transaction ID
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  /**
   * Get payment statistics
   */
  async getStats(request: FastifyRequest, reply: FastifyReply) {
    const apiKeyId = request.apiKey?.id;
    const query = request.query as {
      startDate?: string;
      endDate?: string;
    };

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    const where: any = { apiKeyId };

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [total, completed, failed, pending, processing, amounts] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.payment.count({ where: { ...where, status: 'FAILED' } }),
      prisma.payment.count({ where: { ...where, status: 'PENDING' } }),
      prisma.payment.count({ where: { ...where, status: 'PROCESSING' } }),
      prisma.payment.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { amount: true },
        _avg: { amount: true },
        _min: { amount: true },
        _max: { amount: true },
      }),
    ]);

    return {
      total,
      byStatus: {
        completed,
        failed,
        pending,
        processing,
      },
      amounts: {
        total: amounts._sum.amount || 0,
        average: amounts._avg.amount || 0,
        min: amounts._min.amount || 0,
        max: amounts._max.amount || 0,
      },
      successRate: total > 0 ? (completed / total) * 100 : 0,
    };
  }

  /**
   * Cancel a payment
   */
  async cancel(request: FastifyRequest, reply: FastifyReply) {
    const { transactionId } = request.params as { transactionId: string };
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        transactionId,
        apiKeyId,
      },
    });

    if (!payment) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Cannot cancel payment in current status',
      });
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED' },
    });

    return {
      id: updatedPayment.id,
      transactionId: updatedPayment.transactionId,
      status: updatedPayment.status,
      message: 'Payment cancelled successfully',
    };
  }

  /**
   * Send notification for a payment
   */
  async sendNotification(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { message } = request.body as { message: string };
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Find the payment
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { id },
          { transactionId: id }
        ],
        apiKeyId,
      },
    });

    if (!payment) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    if (!payment.providerReference) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Payment does not have a provider reference',
      });
    }

    try {
      // Get the provider
      const provider = ProviderFactory.getProvider((payment.provider || 'MTN').toLowerCase() as any);

      // Send notification (only MTN supports this currently)
      if (provider instanceof MTNMobileMoneyProvider) {
        const result = await provider.sendNotification(payment.providerReference, message);

        // Store notification in database
        await prisma.paymentNotification.create({
          data: {
            paymentId: payment.id,
            message: message.substring(0, 160), // Ensure max 160 chars
            delivered: result.success,
            deliveredAt: result.success ? new Date() : null,
            provider: payment.provider,
            response: result as any,
          },
        });

        if (result.success) {
          return {
            success: true,
            message: 'Notification sent successfully',
            paymentId: payment.id,
          };
        } else {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: result.message,
          });
        }
      } else {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Provider does not support notifications',
        });
      }
    } catch (error: any) {
      logger.error({ error, paymentId: payment.id }, 'Error sending notification');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Refund a payment
   */
  async refund(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { amount, reason } = request.body as { amount?: number; reason?: string };
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Find the payment
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { id },
          { transactionId: id }
        ],
        apiKeyId,
      },
      include: {
        refunds: true,
      },
    });

    if (!payment) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    // Check if payment can be refunded
    if (payment.status !== 'COMPLETED') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Only completed payments can be refunded',
      });
    }

    // Check if already refunded or refund is in progress
    const existingRefund = payment.refunds?.find(r => r.status === 'COMPLETED' || r.status === 'PENDING' || r.status === 'PROCESSING');
    if (existingRefund) {
      const statusMessage = existingRefund.status === 'COMPLETED' ?
        'Payment has already been refunded' :
        'A refund is already in progress for this payment';

      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: statusMessage,
        refundId: existingRefund.id,
        refundStatus: existingRefund.status
      });
    }

    // Validate refund amount
    const refundAmount = amount || payment.amount;
    if (refundAmount > payment.amount) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Refund amount cannot exceed payment amount',
      });
    }

    try {
      // Get the provider
      const provider = ProviderFactory.getProvider((payment.provider || 'MTN').toLowerCase() as any);

      if (!provider) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Provider not available',
        });
      }

      // Extract the original request reference (X-Reference-Id) from metadata for refunds
      const originalRequestReference = (payment.metadata as any)?.originalRequestReference;
      const providerReference = (payment.metadata as any)?.providerReference || payment.providerReference;

      if (!originalRequestReference) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Payment does not have an original request reference - cannot process refund. This payment was created before refund support was added.',
        });
      }

      logger.info({
        paymentId: payment.id,
        transactionId: payment.transactionId,
        originalRequestReference,
        providerReference,
        paymentMetadata: payment.metadata,
        refundAmount
      }, 'Processing refund with MTN original request reference');

      // Process refund using MTN's original X-Reference-Id
      const result = await provider.refund(originalRequestReference, refundAmount);

      // Generate a unique refund reference ID if provider didn't return one
      const refundReferenceId = result.refundId || `fp_refund_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Store refund in database with enhanced error details
      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          refundReferenceId,
          amount: refundAmount,
          currency: payment.currency,
          status: result.status as RefundStatus,
          reason,
          financialTransactionId: result.financialTransactionId,
          providerResponse: {
            ...result,
            errorDetails: result.errorDetails || null,
          } as any,
          completedAt: result.status === 'COMPLETED' ? new Date() : null,
        } as any,
      });

      // If completed immediately but missing financialTransactionId, fetch status once to capture
      if (result.status === 'COMPLETED' && !(refund as any).financialTransactionId) {
        try {
          const statusResult = await provider.checkRefundStatus(refund.refundReferenceId);
          if ((statusResult as any).financialTransactionId) {
            const patched = await prisma.refund.update({
              where: { id: refund.id },
              data: { financialTransactionId: (statusResult as any).financialTransactionId } as any
            });
            logger.info({ refundId: patched.id, finId: (patched as any).financialTransactionId }, 'Captured financialTransactionId on immediate COMPLETED refund');
          }
        } catch (immediateErr) {
          logger.warn({ refundId: refund.id, immediateErr }, 'Failed to capture financialTransactionId on immediate COMPLETED refund');
        }
      }

      // Update payment status if refund is completed
      if (result.status === 'COMPLETED') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED' },
        });
      }

      return {
        success: result.success,
        refundId: refund.id,
        refundReferenceId: refund.refundReferenceId,
        amount: refund.amount,
        status: refund.status,
        financialTransactionId: (refund as any).financialTransactionId || null,
        message: result.message,
        createdAt: refund.createdAt.toISOString(),
        errorCode: result.errorCode,
        errorDetails: result.errorDetails,
      };
    } catch (error: any) {
      logger.error({ error, paymentId: payment.id }, 'Error processing refund');

      // Handle unique constraint error for refund reference ID
      if (error.code === 'P2002' && error.meta?.target?.includes('refund_reference_id')) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'A refund for this payment is already being processed',
        });
      }

      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Get refund status
   */
  async getRefundStatus(request: FastifyRequest, reply: FastifyReply) {
    const { refundId } = request.params as { refundId: string };
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Find the refund
    const refund = await prisma.refund.findFirst({
      where: {
        OR: [
          { id: refundId },
          { refundReferenceId: refundId }
        ],
        payment: {
          apiKeyId,
        },
      },
      include: {
        payment: true,
      },
    });

    if (!refund) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Refund not found',
      });
    }

    // If refund is still pending, check with provider
    if (refund.status === 'PENDING' || refund.status === 'PROCESSING') {
      try {
        const provider = ProviderFactory.getProvider((refund.payment.provider || 'MTN').toLowerCase() as any);

        if (provider instanceof MTNMobileMoneyProvider) {
          const statusResult = await provider.checkRefundStatus(refund.refundReferenceId);

          // Update refund status in database
          const updatedRefund = await prisma.refund.update({
            where: { id: refund.id },
            data: {
              status: statusResult.status as RefundStatus,
              completedAt: statusResult.status === 'COMPLETED' ? new Date() : null,
              financialTransactionId: (statusResult as any).financialTransactionId || (refund as any).financialTransactionId,
              providerResponse: statusResult as any,
            } as any,
          });

          // Update payment status if refund is completed
          if (statusResult.status === 'COMPLETED') {
            await prisma.payment.update({
              where: { id: refund.paymentId },
              data: { status: 'REFUNDED' },
            });
          }

          refund.status = updatedRefund.status;
          refund.completedAt = updatedRefund.completedAt;
        }
      } catch (error) {
        logger.error({ error, refundId }, 'Error checking refund status with provider');
      }
    }

    return {
      id: refund.id,
      refundReferenceId: refund.refundReferenceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      financialTransactionId: (refund as any).financialTransactionId || null,
      reason: refund.reason,
      createdAt: refund.createdAt.toISOString(),
      completedAt: refund.completedAt?.toISOString() || null,
    };
  }

  /**
   * List refunds for a payment
   */
  async listRefunds(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Find the payment
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { id },
          { transactionId: id }
        ],
        apiKeyId,
      },
      include: {
        refunds: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!payment) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    return {
      paymentId: payment.id,
      refunds: payment.refunds.map(refund => ({
        id: refund.id,
        refundReferenceId: refund.refundReferenceId,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        financialTransactionId: (refund as any).financialTransactionId || null,
        reason: refund.reason,
        createdAt: refund.createdAt.toISOString(),
        completedAt: refund.completedAt?.toISOString() || null,
      })),
    };
  }

  /**
   * Request withdrawal (Request-to-Withdraw)
   */
  async requestWithdraw(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { accountId, amount, currency, description, id } = request.body as {
        accountId: string;
        amount: number;
        currency: string;
        description?: string;
        id?: string;
      };
      const apiKeyId = request.apiKey?.id;

      if (!apiKeyId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key required',
        });
      }

      // Extract phone number from accountId (format: 237XXXXXXXXX@cameroon)
      const phoneNumber = accountId.split('@')[0];
      const withdrawId = id || `withdraw_${Date.now()}_${Math.random().toString(36).substring(2)}`;

      // Get provider for the phone number (detect MTN vs Orange)
      const providerType = ProviderFactory.detectProvider(phoneNumber);
      const provider = ProviderFactory.getProvider(providerType);

      if (!provider) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Payment provider not available',
        });
      }

      const withdrawRequest = {
        withdrawId: withdrawId,
        from: phoneNumber,
        amount: amount,
        currency: currency,
        description: description,
        payerMessage: 'Withdrawal request from FlowPay',
      };

      logger.info({ withdrawId, withdrawRequest }, 'Processing withdrawal request');

      const result = await provider.requestWithdraw(withdrawRequest);

      // Map provider status to database enum
      const dbStatus = this.mapWithdrawStatusToDbStatus(result.status);

      // Store withdrawal in database with complete raw responses
      const withdrawal = await prisma.withdrawal.create({
        data: {
          withdrawId: result.withdrawId,
          accountId: accountId,
          amount: amount,
          currency: currency,
          description: description,
          status: dbStatus,
          provider: providerType.toUpperCase() as any,
          providerReference: result.referenceId,
          fee: result.fee || null,
          userId: request.apiKey?.userId || null,
          metadata: {
            originalRequest: withdrawRequest,
            phoneNumber: phoneNumber,
            providerType: providerType,
          },
          // Store complete raw provider request and response
          rawCreateRequest: withdrawRequest as any,
          rawCreateResponse: result as any,
          rawStatusResponse: Prisma.JsonNull, // Will be populated on status checks
          apiKeyId: apiKeyId,
          completedAt: result.status === 'COMPLETED' ? new Date() : null,
        },
      });

      logger.info({ withdrawId, result, dbStatus }, 'Withdrawal request completed and stored');

      return reply.status(202).send({
        statusCode: 202,
        message: 'Withdrawal request submitted successfully',
        data: {
          id: withdrawal.id,
          withdrawId: result.withdrawId,
          referenceId: result.referenceId,
          status: result.status,
          message: result.message,
          timestamp: result.timestamp,
          accountId: accountId,
          amount: amount,
          currency: currency,
          createdAt: withdrawal.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Error processing withdrawal request');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to process withdrawal request',
        details: error.message,
      });
    }
  }

  /**
   * Get withdrawal status
   */
  async getWithdrawStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { withdrawId } = request.params as { withdrawId: string };
      const apiKeyId = request.apiKey?.id;

      if (!apiKeyId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key required',
        });
      }

      // Find the withdrawal in the database
      const withdrawal = await prisma.withdrawal.findFirst({
        where: {
          OR: [
            { withdrawId },
            { id: withdrawId }
          ],
          apiKeyId,
        },
      });

      if (!withdrawal) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Withdrawal not found',
        });
      }

      // If withdrawal is still pending or processing, check with provider
      if (withdrawal.status === 'PENDING' || withdrawal.status === 'PROCESSING') {
        try {
          const providerType = withdrawal.provider?.toLowerCase() as 'mtn' | 'orange' || 'mtn';
          const provider = ProviderFactory.getProvider(providerType);

          if (provider) {
            logger.info({ withdrawId }, 'Checking withdrawal status with provider');

            const status = await provider.checkWithdrawStatus(withdrawId);
            const dbStatus = this.mapWithdrawStatusToDbStatus(status.status);

            // Update withdrawal status in database with complete raw status response
            const updatedWithdrawal = await prisma.withdrawal.update({
              where: { id: withdrawal.id },
              data: {
                status: dbStatus,
                completedAt: status.status === 'COMPLETED' ? new Date() : null,
                // Store complete raw status response
                rawStatusResponse: status as any,
              },
            });

            withdrawal.status = updatedWithdrawal.status;
            withdrawal.completedAt = updatedWithdrawal.completedAt;

            logger.info({ withdrawId, status, dbStatus }, 'Withdrawal status updated with raw response');
          }
        } catch (error) {
          logger.error({ error, withdrawId }, 'Error checking withdrawal status with provider');
        }
      }

      return reply.status(200).send({
        statusCode: 200,
        message: 'Withdrawal status retrieved successfully',
        data: {
          id: withdrawal.id,
          withdrawId: withdrawal.withdrawId,
          accountId: withdrawal.accountId,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          status: withdrawal.status,
          provider: withdrawal.provider,
          providerReference: withdrawal.providerReference,
          financialTransactionId: withdrawal.financialTransactionId, // Include MTN's financial transaction ID
          description: withdrawal.description,
          createdAt: withdrawal.createdAt.toISOString(),
          updatedAt: withdrawal.updatedAt.toISOString(),
          completedAt: withdrawal.completedAt?.toISOString() || null,
        },
      });
    } catch (error: any) {
      logger.error({ error, withdrawId: request.params }, 'Error getting withdrawal status');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to get withdrawal status',
        details: error.message,
      });
    }
  }

  /**
   * Map provider withdrawal status to database enum
   */
  private mapWithdrawStatusToDbStatus(providerStatus: string): WithdrawalStatus {
    const statusMap: Record<string, WithdrawalStatus> = {
      'PENDING': 'PENDING',
      'PROCESSING': 'PROCESSING',
      'COMPLETED': 'COMPLETED',
      'FAILED': 'FAILED',
      'CANCELLED': 'CANCELLED',
      'EXPIRED': 'EXPIRED',
      'ONGOING': 'ONGOING',
      'DELAYED': 'DELAYED',
    };

    return statusMap[providerStatus] || 'PENDING';
  }
}
