import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { BalanceService } from '../../services/balance.service'
import { WalletService } from '../../services/wallet.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { Provider } from '@prisma/client'

const paramsSchema = z.object({
  provider: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetProviderBalance',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/provider/:provider',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get balance for a specific provider',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { provider } = req.params as z.infer<typeof paramsSchema>
    const apiKeyId = req.apiKey!.id
    const userId = req.user!.userId

    // Validate provider
    const validProviders = ['MTN', 'ORANGE']
    const normalizedProvider = provider.toUpperCase()

    if (!validProviders.includes(normalizedProvider)) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid provider. Supported providers: ${validProviders.join(', ')}`,
        },
      }
    }

    logger.info('Getting specific provider balance', { userId, apiKeyId, provider: normalizedProvider })

    // Get local wallet balance for this provider
    const localBalance = await WalletService.getWalletBalance(userId, normalizedProvider as Provider)

    // Get provider balance
    const providerBalances = await BalanceService.getProviderBalances()
    const specificProvider = providerBalances.providers.find((p) => p.name === normalizedProvider)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          provider: normalizedProvider,
          localWalletBalance: localBalance,
          providerBalance: specificProvider?.success ? specificProvider.balances[0]?.availableBalance || 0 : 0,
          providerStatus: specificProvider?.success
            ? specificProvider.balances[0]?.accountStatus || 'UNKNOWN'
            : 'ERROR',
          totalBalance:
            localBalance + (specificProvider?.success ? specificProvider.balances[0]?.availableBalance || 0 : 0),
          timestamp: new Date(),
          ...(specificProvider?.error && { providerError: specificProvider.error }),
        },
      },
    }
  } catch (error: any) {
    logger.error('Error getting provider balance', { error })
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
