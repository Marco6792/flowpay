import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { WalletService } from '../../services/wallet.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { Provider } from '@prisma/client'

const querySchema = z.object({
  provider: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetTransactionHistory',
  flows: ['balance-management'],
  type: 'api',
  path: '/api/v1/balance/transactions',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get wallet transaction history for the authenticated user',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const apiKeyId = req.apiKey!.id
    const userId = req.user!.userId
    const query = req.query as z.infer<typeof querySchema>

    const limit = parseInt(query.limit || '50', 10)
    const offset = parseInt(query.offset || '0', 10)
    const provider = query.provider ? (query.provider.toUpperCase() as Provider) : undefined

    logger.info('Getting wallet transaction history', { userId, apiKeyId, provider, limit, offset })

    const transactions = await WalletService.getTransactionHistory(userId, provider, limit, offset)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          transactions: transactions.map((tx) => ({
            id: tx.id,
            type: tx.type,
            amount: tx.amount,
            balanceBefore: tx.balanceBefore,
            balanceAfter: tx.balanceAfter,
            reference: tx.reference,
            description: tx.description,
            metadata: tx.metadata,
            createdAt: tx.createdAt.toISOString(),
          })),
          pagination: {
            limit,
            offset,
            count: transactions.length,
            hasMore: transactions.length === limit,
          },
        },
      },
    }
  } catch (error: any) {
    logger.error('Error getting transaction history', { error })
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
