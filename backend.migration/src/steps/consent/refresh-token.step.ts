import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  refreshToken: z.string(),
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'RefreshConsentToken',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/refresh',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Refresh OAuth2 consent token',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>

    const result = await consentService.refreshOAuth2Token({
      refreshToken: data.refreshToken,
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

    return {
      status: 200,
      body: {
        success: true,
        data: {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          refreshToken: result.refreshToken,
          refreshExpiresIn: result.refreshExpiresIn,
        },
      },
    }
  } catch (error: any) {
    logger.error('Token refresh failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
