import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { preApprovalService } from '../../services/preapproval.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  preApprovalId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetPreApprovalStatus',
  flows: ['preapproval-management'],
  type: 'api',
  path: '/api/v1/preapprovals/:preApprovalId/status',
  method: 'GET',
  emits: ['preapproval.updated'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get PreApproval status from provider',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const apiKeyId = req.apiKey!.id
    const { preApprovalId } = req.params as z.infer<typeof paramsSchema>

    const result = await preApprovalService.getPreApprovalStatus(preApprovalId, apiKeyId)

    if (!result.success) {
      return {
        status: 404,
        body: result,
      }
    }

    await emit({
      topic: 'preapproval.updated',
      data: { preApprovalId, status: result.status },
    })

    return {
      status: 200,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to get PreApproval status', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
