import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  accessToken: z.string(),
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'RevokeConsent',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/revoke',
  method: 'POST',
  emits: ['consent.revoked'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Revoke OAuth2 consent',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>

    const result = await consentService.revokeConsent({
      accessToken: data.accessToken,
      provider: data.provider || 'MTN',
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
      topic: 'consent.revoked',
      data: { provider: data.provider || 'MTN' },
    })

    return {
      status: 200,
      body: {
        success: true,
        message: 'Consent revoked successfully',
      },
    }
  } catch (error: any) {
    logger.error('Consent revocation failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
