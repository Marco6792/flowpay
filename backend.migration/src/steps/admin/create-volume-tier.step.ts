import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { requireAdmin } from '../../middleware/admin.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  minVolume: z.number().min(0),
  maxVolume: z.number().min(0).optional(),
  percentage: z.number().min(0).max(100),
  minFee: z.number().min(0),
  maxFee: z.number().min(0),
})

export const config: ApiRouteConfig = {
  name: 'CreateVolumeTier',
  flows: ['admin-fee-management'],
  type: 'api',
  path: '/api/v1/admin/fees/volume-tiers',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, requireAdmin],
  description: 'Create a volume-based fee tier',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const validatedData = bodySchema.parse(req.body)

    const tier = await (FeeService as any).createVolumeTier?.(validatedData)

    logger.info('Volume tier created', {
      tierName: validatedData.name,
      adminId: req.user?.id,
    })

    return {
      status: 201,
      body: {
        success: true,
        data: tier,
      },
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'Validation error',
          details: error.errors,
        },
      }
    }

    logger.error('Error creating volume tier', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to create volume tier',
      },
    }
  }
}
