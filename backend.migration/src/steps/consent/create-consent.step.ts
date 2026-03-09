import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  customerId: z.string(),
  scope: z.string(),
  accessType: z.enum(['online', 'offline']),
  consentValidIn: z.union([z.number(), z.string()]).optional(),
  businessId: z.string(),
  description: z.string().optional(),
  provider: z.string().optional(),
  metadata: z.any().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateConsent',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent',
  method: 'POST',
  emits: ['consent.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create general consent authorization',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const consentData = req.body as z.infer<typeof bodySchema>

    // Handle form-encoded data conversion
    let metadata: Record<string, any> | undefined = consentData.metadata
    if (typeof consentData.metadata === 'string') {
      try {
        metadata = JSON.parse(consentData.metadata)
      } catch {
        metadata = {}
      }
    }

    let consentValidIn = consentData.consentValidIn
    if (typeof consentValidIn === 'string') {
      consentValidIn = parseInt(consentValidIn, 10) || undefined
    }

    const result = await consentService.createConsent({
      customerId: consentData.customerId,
      scope: consentData.scope,
      accessType: consentData.accessType,
      consentValidIn,
      businessId: consentData.businessId,
      description: consentData.description,
      provider: consentData.provider || 'MTN',
      metadata,
    })

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
      topic: 'consent.created',
      data: { authReqId: result.authReqId, customerId: consentData.customerId },
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
    logger.error('Consent creation failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
