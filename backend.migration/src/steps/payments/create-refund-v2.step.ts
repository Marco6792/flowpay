import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  transactionId: z.string(),
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateRefundV2',
  flows: ['payment-processing', 'refund-management'],
  type: 'api',
  path: '/api/v1/refunds/v2',
  method: 'POST',
  emits: ['refund.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a refund using MTN Disbursement v2.0 API',
}

export const handler = async (req: any, { logger, emit }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>
    const providerName = (data.provider || 'MTN').toLowerCase() as ProviderType
    const provider = ProviderFactory.getProvider(providerName) as any

    if (typeof provider.refundV2 !== 'function') {
      // Fall back to the standard refund which already tries v2.0 then v1.0
      const result = await provider.refund(data.transactionId, data.amount)

      if (result.success) {
        await emit({
          topic: 'refund.created',
          data: {
            refundId: result.refundId,
            transactionId: data.transactionId,
            amount: result.amount,
            status: result.status,
            provider: providerName,
            version: 'v2-fallback',
          },
        })
      }

      return {
        status: result.success ? 201 : 400,
        body: {
          success: result.success,
          data: {
            refundId: result.refundId,
            amount: result.amount,
            status: result.status,
            financialTransactionId: result.financialTransactionId,
            message: result.message,
            version: 'v2-fallback',
          },
        },
      }
    }

    const result = await provider.refundV2(data.transactionId, data.amount, data.reason)

    if (result.success) {
      await emit({
        topic: 'refund.created',
        data: {
          refundId: result.refundId,
          transactionId: data.transactionId,
          amount: result.amount,
          status: result.status,
          provider: providerName,
          version: 'v2',
        },
      })
    }

    return {
      status: result.success ? 201 : 400,
      body: {
        success: result.success,
        data: {
          refundId: result.refundId,
          amount: result.amount,
          status: result.status,
          financialTransactionId: result.financialTransactionId,
          message: result.message,
          version: 'v2',
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to create v2 refund', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
