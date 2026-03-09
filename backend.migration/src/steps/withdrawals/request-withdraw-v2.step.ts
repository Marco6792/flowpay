import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import crypto from 'crypto'

const bodySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional(),
  from: z.string(),
  payerMessage: z.string().optional(),
  description: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'RequestWithdrawV2',
  flows: ['withdrawal-processing'],
  type: 'api',
  path: '/api/v1/withdraw/v2',
  method: 'POST',
  emits: ['withdrawal.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Request a withdrawal using MTN Collection v2.0 API',
}

export const handler = async (req: any, { logger, emit }: FlowContext) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>
    const providerName = (data.provider || 'MTN').toLowerCase() as ProviderType
    const provider = ProviderFactory.getProvider(providerName) as any

    if (typeof provider.requestWithdrawV2 !== 'function') {
      return {
        status: 400,
        body: {
          success: false,
          error: 'V2 withdrawal not supported by this provider',
        },
      }
    }

    const withdrawId = crypto.randomUUID()

    const result = await provider.requestWithdrawV2({
      withdrawId,
      from: data.from,
      amount: data.amount,
      currency: data.currency || 'XAF',
      description: data.description,
      payerMessage: data.payerMessage,
    })

    if (result.success) {
      await emit({
        topic: 'withdrawal.created',
        data: {
          withdrawId,
          referenceId: result.referenceId,
          status: result.status,
          provider: providerName,
          amount: data.amount,
          currency: data.currency || 'XAF',
          version: 'v2',
        },
      })
    }

    return {
      status: result.success ? 201 : 400,
      body: {
        success: result.success,
        data: {
          withdrawId,
          providerWithdrawId: result.providerWithdrawId,
          referenceId: result.referenceId,
          status: result.status,
          message: result.message,
          version: 'v2',
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to create v2 withdrawal', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
