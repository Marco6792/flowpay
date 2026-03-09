import { ApiRouteConfig, FlowContext } from 'motia'
import { BalanceService } from '../../services/balance.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'GetProviderBalances',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/providers',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get balances from all payment providers',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const providers = await BalanceService.getProviderBalances()

  return {
    status: 200,
    body: {
      success: true,
      data: providers,
    },
  }
}
