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
  name: 'GetUserInfoFromToken',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/userinfo',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get user info using OAuth2 access token',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>

    const result = await consentService.getUserInfoFromToken({
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

    return {
      status: 200,
      body: {
        success: true,
        data: {
          userInfo: 'userInfo' in result ? result.userInfo : undefined,
        },
      },
    }
  } catch (error: any) {
    logger.error('User info retrieval failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
