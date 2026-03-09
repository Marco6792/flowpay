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
  name: 'GetAccountUserInfo',
  flows: ['money-transfers'],
  type: 'api',
  path: '/api/v1/account/userinfo',
  method: 'POST',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get user information for an account holder',
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
    const userInfo = await transferService.getUserInfo(accountId, provider)

    if (!userInfo.success) {
      return {
        status: 400,
        body: {
          success: false,
          error: userInfo.message,
        },
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          accountId,
          userInfo: userInfo.userInfo,
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to get user info', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
