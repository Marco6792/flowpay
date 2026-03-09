import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  customerId: z.string(),
  businessId: z.string(),
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateAccountAccessConsent',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/account-access',
  method: 'POST',
  emits: ['consent.account-access.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create account access consent',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>

    const result = await consentService.createAccountAccessConsent(
      data.customerId,
      data.businessId
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
      topic: 'consent.account-access.created',
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
    logger.error('Account access consent creation failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
