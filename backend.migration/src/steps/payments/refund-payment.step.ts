import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { ProviderFactory } from '../../services/providers/provider.factory'
import { RefundStatus } from '@prisma/client'

const paramsSchema = z.object({
  id: z.string(),
})

const bodySchema = z.object({
  amount: z.number().optional(),
  reason: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'RefundPayment',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/:id/refund',
  method: 'POST',
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Refund a completed payment',
  emits: ['payment.refunded'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const { amount, reason } = req.body as z.infer<typeof bodySchema>
    const apiKeyId = req.apiKey!.id

    // Find the payment
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id }, { transactionId: id }],
        apiKeyId,
      },
      include: {
        refunds: true,
      },
    })

    if (!payment) {
      return {
        status: 404,
        body: {
          statusCode: 404,
          error: 'Not Found',
          message: 'Payment not found',
        },
      }
    }

    // Check if payment can be refunded
    if (payment.status !== 'COMPLETED') {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Only completed payments can be refunded',
        },
      }
    }

    // Check if already refunded or refund is in progress
    const existingRefund = payment.refunds?.find(
      (r) => r.status === 'COMPLETED' || r.status === 'PENDING' || r.status === 'PROCESSING'
    )
    if (existingRefund) {
      const statusMessage =
        existingRefund.status === 'COMPLETED'
          ? 'Payment has already been refunded'
          : 'A refund is already in progress for this payment'

      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: statusMessage,
          refundId: existingRefund.id,
          refundStatus: existingRefund.status,
        },
      }
    }

    // Validate refund amount
    const refundAmount = amount || payment.amount
    if (refundAmount > payment.amount) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Refund amount cannot exceed payment amount',
        },
      }
    }

    // Get the provider
    const provider = ProviderFactory.getProvider((payment.provider || 'MTN').toLowerCase() as any)

    if (!provider) {
      return {
        status: 500,
        body: {
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Provider not available',
        },
      }
    }

    // Extract the original request reference
    const originalRequestReference = (payment.metadata as any)?.originalRequestReference
    const providerReference = (payment.metadata as any)?.providerReference || payment.providerReference

    if (!originalRequestReference) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Payment does not have an original request reference - cannot process refund',
        },
      }
    }

    logger.info('Processing refund', {
      paymentId: payment.id,
      transactionId: payment.transactionId,
      originalRequestReference,
      providerReference,
      refundAmount,
    })

    // Process refund
    const result = await provider.refund(originalRequestReference, refundAmount)

    // Generate refund reference ID
    const refundReferenceId =
      result.refundId || `fp_refund_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    // Store refund in database
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
    })

    // Emit refund event
    await emit({
      topic: 'payment.refunded',
      data: { paymentId: payment.id, refundId: refund.id, status: result.status },
    })

    logger.info('Refund processed', { paymentId: payment.id, refundId: refund.id, status: result.status })

    return {
      status: 201,
      body: {
        success: true,
        refund: {
          id: refund.id,
          refundReferenceId: refund.refundReferenceId,
          amount: refund.amount,
          currency: refund.currency,
          status: refund.status,
          reason: refund.reason,
          createdAt: refund.createdAt.toISOString(),
        },
      },
    }
  } catch (error: any) {
    logger.error('Error processing refund', { error: error.message })
    return {
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to process refund',
      },
    }
  }
}
