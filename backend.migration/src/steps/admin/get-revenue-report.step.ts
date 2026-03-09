import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  groupBy: z.enum(['day', 'week', 'month']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetRevenueReport',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/revenue',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, requireAdmin],
  description: 'Get fee revenue report with date range and grouping',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query as z.infer<typeof querySchema>

    const report = await (FeeService as any).getRevenueReport?.({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      groupBy,
    })

    return {
      status: 200,
      body: {
        success: true,
        data: report || {
          totalRevenue: 0,
          totalTransactions: 0,
          averageFee: 0,
          breakdown: [],
        },
      },
    }
  } catch (error: any) {
    logger.error('Error getting revenue report', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to get revenue report',
      },
    }
  }
}
