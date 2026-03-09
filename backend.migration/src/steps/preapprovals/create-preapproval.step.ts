import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { preApprovalService } from '../../services/preapproval.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  preApprovalId: z.string().optional(),
  payerPhone: z.string(),
  payerCurrency: z.string().optional(),
  payerMessage: z.string().optional(),
  validityTime: z.number().min(60).max(86400),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreatePreApproval',
  flows: ['preapproval-management'],
  type: 'api',
  path: '/api/v1/preapprovals',
  method: 'POST',
  emits: ['preapproval.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a new PreApproval request',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const apiKeyId = req.apiKey!.id
    const userId = req.user!.userId

    const result = await preApprovalService.createPreApproval(apiKeyId, userId, req.body as any)

    if (!result.success) {
      return {
        status: 400,
        body: result,
      }
    }

    await emit({
      topic: 'preapproval.created',
      data: {
        preApprovalId: result.preApproval?.preApprovalId,
        referenceId: result.preApproval?.referenceId,
        status: result.preApproval?.status,
      },
    })

    return {
      status: 200,
      body: result,
    }
  } catch (error: any) {
    logger.error('Failed to create PreApproval', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
