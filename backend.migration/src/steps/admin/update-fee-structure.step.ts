import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const paramsSchema = z.object({
  id: z.string(),
})

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  percentage: z.number().min(0).max(100).optional(),
  minFee: z.number().min(0).optional(),
  maxFee: z.number().min(0).optional(),
  fixedFee: z.number().min(0).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const config: ApiRouteConfig = {
  name: 'UpdateFeeStructure',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/structures/:id',
  method: 'PUT',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, requireAdmin],
  description: 'Update an existing fee structure',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const validatedData = req.body as z.infer<typeof bodySchema>

    const feeStructure = await FeeService.updateFeeStructure(id, validatedData)

    logger.info(
      'Fee structure updated',
      {
        feeStructureId: id,
        updates: validatedData,
        adminId: req.user?.userId,
      }
    )

    return {
      status: 200,
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
          details: error.issues,
        },
      }
    }

    logger.error('Error updating fee structure', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to update fee structure',
      },
    }
  }
}
