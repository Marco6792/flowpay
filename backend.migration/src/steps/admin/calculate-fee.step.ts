import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const bodySchema = z.object({
  amount: z.number().min(0),
  userId: z.string().cuid(),
})

export const config: ApiRouteConfig = {
  name: 'CalculateFee',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/calculate',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, requireAdmin],
  description: 'Calculate fee preview for a merchant',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { amount, userId } = req.body as z.infer<typeof bodySchema>

    if (!amount || amount <= 0) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'Invalid amount',
        },
      }
    }

    const calculation = await FeeService.calculateFee(amount, userId)
    const monthlyVolume = await FeeService.calculateMonthlyVolume(userId)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          ...calculation,
          monthlyVolume,
        },
      },
    }
  } catch (error: any) {
    logger.error('Error calculating fee', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to calculate fee',
      },
    }
  }
}
