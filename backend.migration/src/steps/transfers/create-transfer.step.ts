import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { TransferService } from '../../services/transfer.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  transferId: z.string().optional(),
  from: z.string(),
  to: z.string(),
  amount: z.number().min(0.01),
  currency: z.string().default('XAF'),
  description: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).default('MTN'),
  metadata: z.any().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateTransfer',
  flows: ['money-transfers'],
  type: 'api',
  path: '/api/v1/transfers',
  method: 'POST',
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a new transfer transaction',
  emits: ['transfer.created'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const transferData = req.body as z.infer<typeof bodySchema>
    const transferService = new TransferService()
    const mode = req.apiKey?.mode || 'SANDBOX'

    const result = await transferService.createTransfer(
      req.apiKey!.id,
      req.user?.userId || null,
      transferData as any,
      mode
    )

    if (result.transfer) {
      await emit({
        topic: 'transfer.created',
        data: { transferId: result.transfer.transferId, status: result.transfer.status, mode },
      })
    }

    logger.info('Transfer created', { transferId: result.transfer?.transferId, mode })

    return {
      status: 201,
      body: {
        success: result.success,
        data: result.transfer ? {
          transferId: result.transfer.transferId,
          status: result.transfer.status,
          amount: result.transfer.amount,
          currency: result.transfer.currency,
          from: result.transfer.from,
          to: result.transfer.to,
          description: result.transfer.description,
          fee: result.transfer.fee,
          providerReference: result.transfer.providerReference,
          createdAt: result.transfer.createdAt?.toISOString(),
          mode: mode.toLowerCase(),
        } : undefined,
        error: result.error,
      },
    }
  } catch (error: any) {
    logger.error('Error creating transfer', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to create transfer',
      },
    }
  }
}
