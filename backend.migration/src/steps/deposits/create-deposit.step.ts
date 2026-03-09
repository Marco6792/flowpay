import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { DepositService } from '../../services/deposit.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  depositId: z.string().optional(),
  accountId: z.string(),
  amount: z.number().min(0.01),
  currency: z.string().default('XAF'),
  description: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).default('MTN'),
  metadata: z.any().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateDeposit',
  flows: ['deposits'],
  type: 'api',
  path: '/api/v1/deposits',
  method: 'POST',
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a new deposit request',
  emits: ['deposit.created'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const depositData = req.body as z.infer<typeof bodySchema>
    const depositService = new DepositService()
    const mode = req.apiKey?.mode || 'SANDBOX'

    const result = await depositService.createDeposit(
      req.apiKey!.id,
      req.user?.userId || null,
      depositData as any,
      mode
    )

    if (result.deposit) {
      await emit({
        topic: 'deposit.created',
        data: { depositId: result.deposit.depositId, status: result.deposit.status, mode },
      })
    }

    logger.info('Deposit created', { depositId: result.deposit?.depositId, mode })

    return {
      status: 201,
      body: {
        success: result.success,
        data: result.deposit ? {
          ...result.deposit,
          createdAt: result.deposit.createdAt?.toISOString(),
          mode: mode.toLowerCase(),
        } : undefined,
        error: result.error,
      },
    }
  } catch (error: any) {
    logger.error('Error creating deposit', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to create deposit',
      },
    }
  }
}
