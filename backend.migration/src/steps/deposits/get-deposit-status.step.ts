import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { DepositService } from '../../services/deposit.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  depositId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetDepositStatus',
  flows: ['deposits'],
  type: 'api',
  path: '/api/v1/deposits/:depositId/status',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get deposit status by ID',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { depositId } = req.params as z.infer<typeof paramsSchema>
  const depositService = new DepositService()

  const status = await depositService.getDepositStatus(depositId, req.apiKey!.id)

  if (!status.success) {
    return {
      status: 404,
      body: {
        success: false,
        error: 'Deposit not found',
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      data: {
        depositId: status.depositId,
        providerDepositId: status.providerDepositId,
        status: status.status,
        amount: status.amount,
        currency: status.currency,
        accountId: status.accountId,
        fee: status.fee,
        completedAt: status.completedAt,
        failureReason: status.failureReason,
        financialTransactionId: status.financialTransactionId,
        lastUpdated: status.lastUpdated,
        cached: status.cached,
      },
    },
  }
}
