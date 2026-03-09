import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { preApprovalService } from '../../services/preapproval.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const querySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'ListPreApprovals',
  flows: ['preapproval-management'],
  type: 'api',
  path: '/api/v1/preapprovals',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'List PreApprovals with pagination and filters',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const apiKeyId = req.apiKey!.id
    const query = req.query as z.infer<typeof querySchema>

    const page = parseInt(query.page || '1', 10)
    const limit = parseInt(query.limit || '10', 10)

    const result = await preApprovalService.listPreApprovals(apiKeyId, page, limit, query.status)

    return {
      status: 200,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to list PreApprovals', { error: error.message })
    return {
      status: 500,
      body: {
        preApprovals: [],
        total: 0,
        page: 1,
        totalPages: 0,
      },
    }
  }
}
