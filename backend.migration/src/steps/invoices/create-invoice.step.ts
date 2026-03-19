import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  externalId: z.string(),
  amount: z.number().positive(),
  currency: z.string().optional(),
  validityDuration: z.number().optional(),
  intendedPayer: z
    .object({
      partyIdType: z.string(),
      partyId: z.string(),
    })
    .optional(),
  payee: z
    .object({
      partyIdType: z.string(),
      partyId: z.string(),
    })
    .optional(),
  description: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateInvoice',
  flows: ['payment-processing', 'invoices'],
  type: 'api',
  path: '/api/v1/invoices',
  method: 'POST',
  emits: ['invoice.created'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create an invoice for deferred payment (MTN Collection v2)',
}

export const handler = async (req: any, { logger, emit }: FlowContext<any>) => {
  try {
    const invoiceData = req.body as z.infer<typeof bodySchema>
    const provider = ProviderFactory.getProvider((invoiceData.provider || 'MTN').toLowerCase() as ProviderType)
    if (!provider) {
      return {
        status: 400,
        body: { success: false, error: 'Provider not found' },
      }
    }

    const { provider: _providerField, ...invoiceParams } = invoiceData
    const result = await provider.createInvoice({
      ...invoiceParams,
      currency: invoiceData.currency || 'XAF',
    })

    if (result.success) {
      await emit({
        topic: 'invoice.created',
        data: {
          invoiceId: result.invoiceId,
          referenceId: result.referenceId,
          externalId: result.externalId,
          status: result.status,
        },
      })
    }

    return {
      status: result.success ? 201 : 400,
      body: {
        success: result.success,
        data: {
          invoiceId: result.invoiceId,
          referenceId: result.referenceId,
          status: result.status,
          externalId: result.externalId,
          message: result.message,
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to create invoice', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
