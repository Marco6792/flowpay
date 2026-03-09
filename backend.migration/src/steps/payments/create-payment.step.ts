import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { PaymentService } from '../../services/payment.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  from: z.string().regex(/^237[0-9]{9}@cameroon$/),
  to: z.string().regex(/^237[0-9]{9}@cameroon$/),
  amount: z.number().min(100).max(5000000),
  timestamp: z.string().datetime(),
  id: z.string().max(100).optional(),
  provider: z.string().optional(),
  providerMode: z.string().optional(),
  providerOptions: z.any().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreatePayment',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments',
  method: 'POST',
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a new payment transaction',
  emits: ['payment.created'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const paymentData = req.body as z.infer<typeof bodySchema>
    const apiKeyId = req.apiKey!.id
    const mode = req.apiKey?.mode || 'SANDBOX'

    const paymentService = new PaymentService()
    const payment = await paymentService.createPayment(paymentData as any, apiKeyId, mode)

    // Emit payment created event for background processing (include mode for downstream)
    await emit({
      topic: 'payment.created',
      data: {
        paymentId: payment.id,
        transactionId: payment.transactionId,
        status: payment.status,
        mode,
      },
    })

    logger.info('Payment created', { transactionId: payment.transactionId, status: payment.status, mode })

    return {
      status: 201,
      body: {
        id: payment.id,
        transactionId: payment.transactionId,
        status: payment.status,
        amount: payment.amount,
        from: payment.from,
        to: payment.to,
        currency: payment.currency,
        timestamp: payment.timestamp.toISOString(),
        createdAt: payment.createdAt.toISOString(),
        financialTransactionId: payment.financialTransactionId,
        mode: mode.toLowerCase(),
      },
    }
  } catch (error: any) {
    logger.error('Error creating payment', { error: error.message })

    if (error.code === 'P2002') {
      return {
        status: 409,
        body: {
          statusCode: 409,
          error: 'Conflict',
          message: 'Payment with this transaction ID already exists',
        },
      }
    }

    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to create payment',
      },
    }
  }
}
