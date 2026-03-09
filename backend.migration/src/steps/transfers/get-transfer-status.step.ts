import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { TransferService } from '../../services/transfer.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  transferId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetTransferStatus',
  flows: ['money-transfers'],
  type: 'api',
  path: '/api/v1/transfers/:transferId/status',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get live transfer status from provider (not cached)',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { transferId } = req.params as z.infer<typeof paramsSchema>
    const apiKeyId = req.apiKey!.id

    const transferService = new TransferService()
    const status = await transferService.getTransferStatus(transferId, apiKeyId)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          transferId: status.transferId,
          providerTransferId: status.providerTransferId,
          status: status.status,
          amount: status.amount,
          fee: status.fee || null,
          completedAt: status.completedAt,
          failureReason: status.failureReason || null,
          financialTransactionId: status.financialTransactionId,
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to get transfer status', { error: error.message })

    if (error.message === 'Transfer not found' || error.message === 'Transfer not yet processed by provider') {
      return {
        status: 404,
        body: {
          success: false,
          error: error.message,
        },
      }
    }

    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
