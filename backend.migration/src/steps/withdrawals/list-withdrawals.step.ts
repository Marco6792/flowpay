import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { withdrawalService } from '../../services/withdrawal.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const querySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'ListWithdrawals',
  flows: ['withdrawals'],
  type: 'api',
  path: '/api/v1/withdraw',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'List all withdrawals with pagination and optional status filter',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { page = '1', limit = '10', status } = req.query as z.infer<typeof querySchema>
    const apiKeyId = req.apiKey!.id

    const pageNum = parseInt(page, 10)
    const limitNum = parseInt(limit, 10)

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'Invalid page or limit parameters',
        },
      }
    }

    const result = await withdrawalService.listWithdrawals(apiKeyId, pageNum, limitNum, status)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          withdrawals: result.withdrawals.map((withdrawal) => ({
            withdrawId: withdrawal.withdrawId,
            status: withdrawal.status,
            amount: withdrawal.amount,
            currency: withdrawal.currency,
            accountId: withdrawal.accountId,
            description: withdrawal.description || null,
            fee: withdrawal.fee || null,
            providerReference: withdrawal.providerReference,
            financialTransactionId: (withdrawal as any).financialTransactionId || null,
            createdAt: withdrawal.createdAt,
            completedAt: withdrawal.completedAt,
          })),
          pagination: {
            page: result.page,
            limit: limitNum,
            total: result.total,
            totalPages: result.totalPages,
          },
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to list withdrawals', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
