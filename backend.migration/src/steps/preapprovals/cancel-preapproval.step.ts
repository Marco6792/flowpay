import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { preApprovalService } from '../../services/preapproval.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  preApprovalId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'CancelPreApproval',
  flows: ['preapproval-management'],
  type: 'api',
  path: '/api/v1/preapprovals/:preApprovalId/cancel',
  method: 'POST',
  emits: ['preapproval.cancelled'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Cancel a PreApproval',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const apiKeyId = req.apiKey!.id
    const { preApprovalId } = req.params as z.infer<typeof paramsSchema>

    const result = await preApprovalService.cancelPreApproval(preApprovalId, apiKeyId)

    if (!result.success) {
      return {
        status: 400,
        body: result,
      }
    }

    await emit({
      topic: 'preapproval.cancelled',
      data: { preApprovalId, status: result.status },
    })

    return {
      status: 200,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to cancel PreApproval', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
