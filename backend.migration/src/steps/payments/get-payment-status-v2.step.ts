import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  referenceId: z.string(),
})

const querySchema = z.object({
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetPaymentStatusV2',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/v2/:referenceId/status',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get payment status using MTN Collection v2.0 API',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { referenceId } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const providerInstance = ProviderFactory.getProvider(provider.toLowerCase() as ProviderType) as any

    if (typeof providerInstance.checkStatusV2 !== 'function') {
      return {
        status: 400,
        body: {
          success: false,
          error: 'V2 status check not supported by this provider',
        },
      }
    }

    const status = await providerInstance.checkStatusV2(referenceId)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          ...status,
          version: 'v2',
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to get v2 payment status', { error: error.message })
    return {
      status: error.message.includes('Failed to check') ? 404 : 500,
      body: {
        success: false,
        error: error.message,
      },
    }
  }
}
