import { ApiRouteConfig, FlowContext } from 'motia'
import { BalanceService } from '../../services/balance.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'GetAggregatedBalance',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/aggregated',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get aggregated balances across all providers and local wallets',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const mode = req.apiKey?.mode || 'SANDBOX'
  const balanceData = await BalanceService.getAggregatedBalance(req.apiKey!.userId, mode)

  return {
    status: 200,
    body: {
      success: true,
      data: balanceData,
      mode: mode.toLowerCase(),
    },
  }
}
