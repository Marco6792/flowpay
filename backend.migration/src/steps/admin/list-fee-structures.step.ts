import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const querySchema = z.object({
  includeInactive: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'ListFeeStructures',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/structures',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, requireAdmin],
  description: 'List all fee structures',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const query = req.query as z.infer<typeof querySchema>
    const includeInactive = query.includeInactive === 'true'

    const structures = await FeeService.listFeeStructures(includeInactive)

    return {
      status: 200,
      body: {
        success: true,
        data: structures || [],
      },
    }
  } catch (error: any) {
    logger.error('Error listing fee structures', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to list fee structures',
      },
    }
  }
}
