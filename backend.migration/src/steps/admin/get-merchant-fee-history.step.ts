import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const paramsSchema = z.object({
  userId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetMerchantFeeHistory',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/merchants/:userId/history',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, requireAdmin],
  description: 'Get merchant fee assignment history',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { userId } = req.params as z.infer<typeof paramsSchema>

    const history = await FeeService.getMerchantFeeHistory(userId)

    return {
      status: 200,
      body: {
        success: true,
        data: history || [],
      },
    }
  } catch (error: any) {
    logger.error('Error getting merchant fee history', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to get merchant fee history',
      },
    }
  }
}
