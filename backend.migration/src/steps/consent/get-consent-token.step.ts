import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { consentService } from '../../services/consent.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  authReqId: z.string(),
})

const querySchema = z.object({
  provider: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetConsentToken',
  flows: ['consent-management'],
  type: 'api',
  path: '/api/v1/consent/:authReqId/token',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get access token from consent authorization',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { authReqId } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const result = await consentService.getTokenFromConsent({
      authReqId,
      provider,
    })

    if (!result.success) {
      // If consent not yet approved, return appropriate status
      if (result.message?.includes('pending') || result.message?.includes('waiting')) {
        return {
          status: 202,
          body: {
            success: false,
            error: 'Consent approval pending',
            message: 'Customer has not yet approved the consent. Please try again later.',
          },
        }
      }

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
    logger.error('Token retrieval failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
