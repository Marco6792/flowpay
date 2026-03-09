import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { withdrawalService } from '../../services/withdrawal.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  withdrawId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetWithdrawal',
  flows: ['withdrawals'],
  type: 'api',
  path: '/api/v1/withdraw/:withdrawId',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get withdrawal by ID',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { withdrawId } = req.params as z.infer<typeof paramsSchema>
  const apiKeyId = req.apiKey!.id

  const result = await withdrawalService.getWithdrawal(withdrawId, apiKeyId)

  if (!result.success) {
    return {
      status: 404,
      body: {
        success: false,
        error: result.error || 'Withdrawal not found',
      },
    }
  }

  const withdrawal = result.withdrawal!
  const responseData = {
    withdrawId: withdrawal.withdrawId,
    status: withdrawal.status,
    amount: withdrawal.amount,
    currency: withdrawal.currency,
    accountId: withdrawal.accountId,
    description: withdrawal.description || null,
    fee: withdrawal.fee || null,
    providerReference: withdrawal.providerReference,
    financialTransactionId: withdrawal.financialTransactionId,
    createdAt: withdrawal.createdAt,
    updatedAt: withdrawal.updatedAt,
    completedAt: withdrawal.completedAt,
  }

  return {
    status: 200,
    body: {
      success: true,
      data: responseData,
    },
  }
}
