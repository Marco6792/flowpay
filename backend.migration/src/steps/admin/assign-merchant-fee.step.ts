import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

const bodySchema = z.object({
  userId: z.string().cuid(),
  feeStructureId: z.string().cuid(),
  customPercentage: z.number().min(0).max(100).optional(),
  customMinFee: z.number().min(0).optional(),
  customMaxFee: z.number().min(0).optional(),
  notes: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'AssignMerchantFee',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/fees/merchants/assign',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, requireAdmin],
  description: 'Assign fee structure to a merchant',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const validatedData = req.body as z.infer<typeof bodySchema>

    const merchantFee = await FeeService.assignMerchantFee({
      ...validatedData,
      createdBy: req.user?.userId,
    })

    logger.info(
      'Merchant fee assigned',
      {
        userId: validatedData.userId,
        feeStructureId: validatedData.feeStructureId,
        adminId: req.user?.userId,
      }
    )

    return {
      status: 201,
      body: {
        success: true,
        data: merchantFee,
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

    logger.error('Error assigning merchant fee', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to assign merchant fee',
      },
    }
  }
}
