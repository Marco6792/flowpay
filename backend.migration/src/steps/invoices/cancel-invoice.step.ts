import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  referenceId: z.string(),
})

const bodySchema = z.object({
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CancelInvoice',
  flows: ['payment-processing', 'invoices'],
  type: 'api',
  path: '/api/v1/invoices/:referenceId',
  method: 'DELETE',
  emits: ['invoice.cancelled'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Cancel an invoice',
}

export const handler = async (req: any, { logger, emit }: FlowContext) => {
  try {
    const { referenceId } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.body as z.infer<typeof bodySchema>

    const providerInstance = ProviderFactory.getProvider(provider.toLowerCase() as ProviderType)
    const result = await providerInstance.cancelInvoice(referenceId)

    if (result.success) {
      await emit({
        topic: 'invoice.cancelled',
        data: { referenceId, provider },
      })
    }

    return {
      status: result.success ? 200 : 400,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to cancel invoice', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: error.message,
      },
    }
  }
}
