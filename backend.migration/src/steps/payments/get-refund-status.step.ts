import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  refundId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetRefundStatus',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/refunds/:refundId/status',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get refund status by refund ID',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { refundId } = req.params as z.infer<typeof paramsSchema>
  const apiKeyId = req.apiKey!.id

  const refund = await prisma.refund.findFirst({
    where: {
      OR: [{ id: refundId }, { refundReferenceId: refundId }],
      payment: { apiKeyId },
    },
    include: {
      payment: {
        select: {
          id: true,
          transactionId: true,
          amount: true,
          currency: true,
        },
      },
    },
  })

  if (!refund) {
    return {
      status: 404,
      body: {
        statusCode: 404,
        error: 'Not Found',
        message: 'Refund not found',
      },
    }
  }

  return {
    status: 200,
    body: {
      id: refund.id,
      refundReferenceId: refund.refundReferenceId,
      paymentId: refund.payment.id,
      paymentTransactionId: refund.payment.transactionId,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      financialTransactionId: (refund as any).financialTransactionId,
      createdAt: refund.createdAt.toISOString(),
      completedAt: refund.completedAt?.toISOString(),
      providerResponse: refund.providerResponse,
    },
  }
}
