import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const paramsSchema = z.object({
  userId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetMerchantCurrentFee',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/merchants/:userId/current',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, requireAdmin],
  description: "Get merchant's current fee structure and monthly volume",
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { userId } = req.params as z.infer<typeof paramsSchema>

    const structure = await FeeService.getMerchantFeeStructure(userId)
    const monthlyVolume = await FeeService.calculateMonthlyVolume(userId)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          structure,
          monthlyVolume,
        },
      },
    }
  } catch (error: any) {
    logger.error('Error getting merchant current fee', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to get merchant current fee',
      },
    }
  }
}
