import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import crypto from 'crypto'

const bodySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional(),
  accountId: z.string(),
  description: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateDepositV2',
  flows: ['deposit-processing'],
  type: 'api',
  path: '/api/v1/deposits/v2',
  method: 'POST',
  emits: ['deposit.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a deposit using MTN Disbursement v2.0 API',
}

export const handler = async (req: any, { logger, emit }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>
    const providerName = (data.provider || 'MTN').toLowerCase() as ProviderType
    const provider = ProviderFactory.getProvider(providerName) as any

    if (typeof provider.depositV2 !== 'function') {
      return {
        status: 400,
        body: {
          success: false,
          error: 'V2 deposit not supported by this provider',
        },
      }
    }

    const depositId = crypto.randomUUID()

    const result = await provider.depositV2({
      depositId,
      accountId: data.accountId,
      amount: data.amount,
      currency: data.currency || 'XAF',
      description: data.description,
    })

    if (result.success) {
      await emit({
        topic: 'deposit.created',
        data: {
          depositId,
          providerDepositId: result.providerDepositId,
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
          depositId,
          providerDepositId: result.providerDepositId,
          status: result.status,
          message: result.message,
          version: 'v2',
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to create v2 deposit', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
