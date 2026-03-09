import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { preApprovalService } from '../../services/preapproval.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  preApprovalId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetPreApproval',
  flows: ['preapproval-management'],
  type: 'api',
  path: '/api/v1/preapprovals/:preApprovalId',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get PreApproval details by ID',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const apiKeyId = req.apiKey!.id
    const { preApprovalId } = req.params as z.infer<typeof paramsSchema>

    const result = await preApprovalService.getPreApproval(preApprovalId, apiKeyId)

    if (!result.success) {
      return {
        status: 404,
        body: result,
      }
    }

    return {
      status: 200,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to get PreApproval', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
