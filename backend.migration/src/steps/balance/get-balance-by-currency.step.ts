import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  currency: z.string(),
})

const querySchema = z.object({
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetBalanceByCurrency',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/currency/:currency',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get account balance in a specific currency',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { currency } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const providerInstance = ProviderFactory.getProvider(provider.toLowerCase() as ProviderType)
    if (!providerInstance) {
      return {
        status: 400,
        body: { success: false, error: 'Provider not found' },
      }
    }
    const balance = await providerInstance.getBalanceByCurrency(currency)

    return {
      status: 200,
      body: {
        success: true,
        data: balance,
      },
    }
  } catch (error: any) {
    logger.error('Failed to get balance by currency', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: error.message,
      },
    }
  }
}
