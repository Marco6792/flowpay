import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  percentage: z.number().min(0).max(100),
  minFee: z.number().min(0),
  maxFee: z.number().min(0),
  fixedFee: z.number().min(0).optional(),
  isDefault: z.boolean().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateFeeStructure',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/structures',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, requireAdmin],
  description: 'Create a new fee structure',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const validatedData = req.body as z.infer<typeof bodySchema>

    const feeStructure = await FeeService.createFeeStructure({
      ...validatedData,
      createdBy: req.user?.userId,
    })

    logger.info(
      {
        feeStructureId: feeStructure?.id,
        name: validatedData.name,
        adminId: req.user?.userId,
      },
      'Fee structure created'
    )

    return {
      status: 201,
      body: {
        success: true,
        data: feeStructure,
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

    logger.error('Error creating fee structure', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to create fee structure',
      },
    }
  }
}
