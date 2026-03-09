import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  id: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'ListPaymentRefunds',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/:id/refunds',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'List all refunds for a payment',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { id } = req.params as z.infer<typeof paramsSchema>
  const apiKeyId = req.apiKey!.id

  // Find the payment
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ id }, { transactionId: id }],
      apiKeyId,
    },
    include: {
      refunds: {
        orderBy: { createdAt: 'desc' },
      },
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

  const refunds = payment.refunds.map((refund) => ({
    id: refund.id,
    refundReferenceId: refund.refundReferenceId,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    financialTransactionId: (refund as any).financialTransactionId,
    createdAt: refund.createdAt.toISOString(),
    completedAt: refund.completedAt?.toISOString(),
  }))

  return {
    status: 200,
    body: {
      paymentId: payment.id,
      transactionId: payment.transactionId,
      refunds,
      total: refunds.length,
    },
  }
}
