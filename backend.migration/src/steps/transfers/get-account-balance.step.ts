import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { TransferService } from '../../services/transfer.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const querySchema = z.object({
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetAccountBalance',
  flows: ['money-transfers', 'balance-management'],
  type: 'api',
  path: '/api/v1/account/balance',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get disbursement account balance from provider',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const transferService = new TransferService()
    const balance = await transferService.getBalance(provider)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          balances: balance.balances,
          timestamp: balance.timestamp,
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to get balance', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
