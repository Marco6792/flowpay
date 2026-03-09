import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { TransferService } from '../../services/transfer.service'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  accountId: z.string(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'ValidateAccount',
  flows: ['money-transfers'],
  type: 'api',
  path: '/api/v1/account/validate',
  method: 'POST',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Validate that an account holder is registered and active',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { accountId, provider = 'MTN' } = req.body as z.infer<typeof bodySchema>

    if (!accountId) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'accountId is required',
        },
      }
    }

    const transferService = new TransferService()
    const validation = await transferService.validateRecipient(accountId, provider)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          accountId,
          isActive: validation.isActive,
          accountHolder: validation.accountHolder || null,
          message: validation.message || null,
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to validate recipient', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
