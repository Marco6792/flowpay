import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  customerId: z.string(),
  businessId: z.string(),
  amount: z.number().min(1),
  frequency: z.enum(['monthly', 'weekly', 'daily']),
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateSubscriptionConsent',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/subscription',
  method: 'POST',
  emits: ['consent.subscription.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create subscription billing consent',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>

    const result = await consentService.createSubscriptionConsent(
      data.customerId,
      data.businessId,
      data.amount,
      data.frequency
    )

    if (!result.success) {
      return {
        status: 400,
        body: {
          success: false,
          error: result.message,
        },
      }
    }

    await emit({
      topic: 'consent.subscription.created',
      data: { authReqId: result.authReqId, customerId: data.customerId },
    })

    return {
      status: 201,
      body: {
        success: true,
        data: {
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          pollUrl: result.pollUrl,
          message: result.message,
        },
      },
    }
  } catch (error: any) {
    logger.error('Subscription consent creation failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
