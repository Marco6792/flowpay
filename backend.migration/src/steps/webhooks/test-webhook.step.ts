import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { env } from '../../config/env'

const bodySchema = z.object({
  paymentId: z.string(),
  status: z.enum(['SUCCESSFUL', 'FAILED']).optional(),
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'TestWebhook',
  flows: ['webhook-management'],
  type: 'api',
  path: '/api/v1/webhooks/test',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware],
  description: 'Simulate a provider webhook for testing (non-production only)',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  if (env.NODE_ENV === 'production') {
    return {
      status: 403,
      body: { error: 'Test endpoint disabled in production' },
    }
  }

  const { paymentId, status, provider = 'mtn' } = req.body as z.infer<typeof bodySchema>

  const testPayload = {
    financialTransactionId: `test_${Date.now()}`,
    externalId: paymentId,
    amount: '10',
    currency: 'XAF',
    payer: {
      partyIdType: 'MSISDN',
      partyId: '237670000000',
    },
    status: status || 'SUCCESSFUL',
    reason: status === 'FAILED' ? 'Insufficient funds' : undefined,
  }

  logger.info('Sending test webhook', { testPayload, provider })

  return {
    status: 200,
    body: {
      success: true,
      message: 'Test webhook payload generated',
      payload: testPayload,
      provider,
    },
  }
}
