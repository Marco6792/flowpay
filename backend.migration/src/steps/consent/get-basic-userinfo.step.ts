import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  msisdn: z.string(),
})

const querySchema = z.object({
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetBasicUserInfo',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/user/basic/:msisdn',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get basic user info without consent (by MSISDN)',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { msisdn } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const result = await consentService.getBasicUserInfo({
      msisdn,
      provider,
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
    logger.error('Basic user info retrieval failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
