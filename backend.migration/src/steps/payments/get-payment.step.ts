import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  transactionId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetPayment',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/:transactionId',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get payment by transaction ID',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { transactionId } = req.params as z.infer<typeof paramsSchema>
  const apiKeyId = req.apiKey!.id

  const payment = await prisma.payment.findFirst({
    where: {
      transactionId,
      apiKeyId,
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

  return {
    status: 200,
    body: {
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
      financialTransactionId: payment.financialTransactionId,
      metadata: payment.metadata,
    },
  }
}
