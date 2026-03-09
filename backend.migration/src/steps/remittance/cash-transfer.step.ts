import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional(),
  externalId: z.string(),
  payee: z.object({
    partyIdType: z.string(),
    partyId: z.string(),
  }),
  payerMessage: z.string().optional(),
  payeeNote: z.string().optional(),
  originatingCountry: z.string(),
  originalAmount: z.string(),
  originalCurrency: z.string(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CashTransfer',
  flows: ['remittance', 'money-transfers'],
  type: 'api',
  path: '/api/v1/remittance/cashtransfer',
  method: 'POST',
  emits: ['cashtransfer.created'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a cash transfer for remittance (MTN Remittance v2)',
}

export const handler = async (req: any, { logger, emit }: FlowContext) => {
  try {
    const transferData = req.body as z.infer<typeof bodySchema>
    const provider = ProviderFactory.getProvider((transferData.provider || 'MTN').toLowerCase() as ProviderType)

    const result = await provider.cashTransfer(transferData)

    if (result.success) {
      await emit({
        topic: 'cashtransfer.created',
        data: {
          transferId: result.transferId,
          referenceId: result.referenceId,
          status: result.status,
        },
      })
    }

    return {
      status: result.success ? 201 : 400,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to create cash transfer', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
