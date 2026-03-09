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
  name: 'GetCashTransferStatus',
  flows: ['remittance', 'money-transfers'],
  type: 'api',
  path: '/api/v1/remittance/cashtransfer/:referenceId/status',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get cash transfer status from provider',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { referenceId } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const providerInstance = ProviderFactory.getProvider(provider.toLowerCase() as ProviderType)
    const status = await providerInstance.getCashTransferStatus(referenceId)

    return {
      status: 200,
      body: {
        success: true,
        data: status,
      },
    }
  } catch (error: any) {
    logger.error('Failed to get cash transfer status', { error: error.message })
    return {
      status: error.message.includes('Failed to get') ? 404 : 500,
      body: {
        success: false,
        error: error.message,
      },
    }
  }
}
