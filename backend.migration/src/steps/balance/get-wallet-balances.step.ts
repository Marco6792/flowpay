import { ApiRouteConfig, FlowContext } from 'motia'
import { BalanceService } from '../../services/balance.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'GetWalletBalances',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/wallets',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get local wallet balances only',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const wallets = await BalanceService.getLocalWalletBalances(req.apiKey!.userId)

  return {
    status: 200,
    body: {
      success: true,
      data: wallets,
    },
  }
}
