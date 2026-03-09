import { ApiRouteConfig, FlowContext } from 'motia'
import { BalanceService } from '../../services/balance.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

export const config: ApiRouteConfig = {
  name: 'RefreshBalance',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/refresh',
  method: 'POST',
  emits: ['balance.refreshed'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Refresh balance cache for the authenticated user',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const apiKeyId = req.apiKey!.id
    const userId = req.user!.userId

    logger.info('Refreshing balance cache', { userId, apiKeyId })

    const cacheResult = await BalanceService.refreshBalanceCache(userId)
    const aggregatedBalance = await BalanceService.getAggregatedBalance(userId)

    await emit({
      topic: 'balance.refreshed',
      data: { userId, refreshedAt: cacheResult.refreshedAt, grandTotal: aggregatedBalance.grandTotal },
    })

    return {
      status: 200,
      body: {
        success: cacheResult.success,
        data: {
          refreshed: cacheResult.success,
          refreshedAt: cacheResult.refreshedAt,
          balances: aggregatedBalance.aggregatedBalances,
          summary: {
            localWalletTotal: aggregatedBalance.localWalletTotal,
            providerBalanceTotal: aggregatedBalance.providerBalanceTotal,
            grandTotal: aggregatedBalance.grandTotal,
          },
        },
      },
    }
  } catch (error: any) {
    logger.error('Error refreshing balance', { error })
    return {
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      },
    }
  }
}
