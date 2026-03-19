import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  accountHolderIdType: z.string(),
  accountHolderId: z.string(),
})

const querySchema = z.object({
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetApprovedPreApprovals',
  flows: ['preapproval-management'],
  type: 'api',
  path: '/api/v1/preapprovals/:accountHolderIdType/:accountHolderId/approved',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get all approved pre-approvals for an account holder',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { accountHolderIdType, accountHolderId } = req.params as z.infer<typeof paramsSchema>
    const { provider = 'MTN' } = req.query as z.infer<typeof querySchema>

    const providerInstance = ProviderFactory.getProvider(provider.toLowerCase() as ProviderType)
    if (!providerInstance) {
      return {
        status: 400,
        body: { success: false, error: 'Provider not found' },
      }
    }
    const preApprovals = await providerInstance.getApprovedPreApprovals(accountHolderIdType, accountHolderId)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          accountHolderIdType,
          accountHolderId,
          preApprovals,
          total: preApprovals.length,
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to get approved pre-approvals', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: error.message,
      },
    }
  }
}
