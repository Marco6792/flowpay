import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  customerId: z.string(),
  businessId: z.string(),
  maxAmount: z.number().min(1),
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateBillPaymentConsent',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/bill-payment',
  method: 'POST',
  emits: ['consent.bill-payment.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create bill payment consent',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>

    const result = await consentService.createBillPaymentConsent(
      data.customerId,
      data.businessId,
      data.maxAmount
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
      topic: 'consent.bill-payment.created',
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
    logger.error('Bill payment consent creation failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
