import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { TransferService } from '../../services/transfer.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  transferId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetTransfer',
  flows: ['money-transfers'],
  type: 'api',
  path: '/api/v1/transfers/:transferId',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get transfer by ID',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { transferId } = req.params as z.infer<typeof paramsSchema>
  const transferService = new TransferService()

  const transfer = await transferService.getTransfer(transferId, req.apiKey!.id)

  if (!transfer) {
    return {
      status: 404,
      body: {
        success: false,
        error: 'Transfer not found',
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      data: {
        transferId: transfer.transferId,
        status: transfer.status,
        amount: transfer.amount,
        currency: transfer.currency,
        from: transfer.from,
        to: transfer.to,
        description: transfer.description,
        fee: transfer.fee,
        providerReference: transfer.providerReference,
        financialTransactionId: (transfer as any).financialTransactionId,
        createdAt: transfer.createdAt.toISOString(),
        updatedAt: transfer.updatedAt.toISOString(),
        completedAt: transfer.completedAt?.toISOString(),
      },
    },
  }
}
