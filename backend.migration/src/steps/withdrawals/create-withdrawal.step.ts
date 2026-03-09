import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { withdrawalService } from '../../services/withdrawal.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  withdrawId: z.string().optional(),
  accountId: z.string(),
  amount: z.number().min(0.01),
  currency: z.string().default('XAF'),
  description: z.string().optional(),
  provider: z.string().default('MTN'),
  metadata: z.any().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateWithdrawal',
  flows: ['withdrawals'],
  type: 'api',
  path: '/api/v1/withdraw',
  method: 'POST',
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a new withdrawal request',
  emits: ['withdrawal.created'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const withdrawalData = req.body as z.infer<typeof bodySchema>
    const apiKeyId = req.apiKey!.id
    const userId = req.user!.userId
    const mode = req.apiKey?.mode || 'SANDBOX'

    const result = await withdrawalService.createWithdrawal(apiKeyId, userId, {
      withdrawId: withdrawalData.withdrawId || `wd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      accountId: withdrawalData.accountId,
      amount: withdrawalData.amount,
      currency: withdrawalData.currency,
      description: withdrawalData.description,
      provider: withdrawalData.provider,
      metadata: withdrawalData.metadata,
    }, mode)

    if (!result.success) {
      return {
        status: 400,
        body: {
          success: false,
          error: result.error,
        },
      }
    }

    await emit({
      topic: 'withdrawal.created',
      data: { withdrawalId: result.withdrawal!.withdrawId, status: result.withdrawal!.status, mode },
    })

    logger.info('Withdrawal created', { withdrawId: result.withdrawal!.withdrawId, mode })

    const responseData = {
      flowpay: result.withdrawal
        ? {
            withdrawId: result.withdrawal.withdrawId,
            status: result.withdrawal.status,
            amount: result.withdrawal.amount,
            currency: result.withdrawal.currency,
            accountId: result.withdrawal.accountId,
            description: result.withdrawal.description || null,
            fee: result.withdrawal.fee || null,
            providerReference: result.withdrawal.providerReference,
            createdAt: result.withdrawal.createdAt,
            mode: mode.toLowerCase(),
          }
        : null,
      provider: result.rawProviderResponse || null,
    }

    return {
      status: 201,
      body: {
        success: true,
        data: responseData,
      },
    }
  } catch (error: any) {
    logger.error('Withdrawal creation failed', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
