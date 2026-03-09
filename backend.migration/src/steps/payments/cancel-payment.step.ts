import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  transactionId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'CancelPayment',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/:transactionId/cancel',
  method: 'POST',
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Cancel a pending payment',
  emits: ['payment.cancelled'],
}

export const handler = async (req: any, { emit }: FlowContext<any>) => {
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

  if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
    return {
      status: 400,
      body: {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Cannot cancel payment in current status',
      },
    }
  }

  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'CANCELLED' },
  })

  await emit({
    topic: 'payment.cancelled',
    data: { paymentId: updatedPayment.id, transactionId: updatedPayment.transactionId },
  })

  return {
    status: 200,
    body: {
      id: updatedPayment.id,
      transactionId: updatedPayment.transactionId,
      status: updatedPayment.status,
      message: 'Payment cancelled successfully',
    },
  }
}
