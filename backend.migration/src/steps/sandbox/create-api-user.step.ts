import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { SandboxService } from '../../services/sandbox.service'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  providerCallbackHost: z.string().min(1, 'providerCallbackHost is required'),
  referenceId: z.string().uuid('referenceId must be a valid UUID v4').optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreateSandboxApiUser',
  flows: ['sandbox-provisioning'],
  type: 'api',
  path: '/api/v1/sandbox/apiuser',
  method: 'POST',
  bodySchema,
  middleware: [coreMiddleware],
  description: 'Create a new API user in the MTN sandbox environment (POST /v1_0/apiuser)',
  emits: [],
}

export const handler = async (req: any, { logger }: FlowContext<any>) => {
  try {
    const { providerCallbackHost, referenceId } = req.body as z.infer<typeof bodySchema>
    const sandboxService = new SandboxService()

    const result = await sandboxService.createApiUser(providerCallbackHost, referenceId)

    if (result.success) {
      logger.info('Sandbox API user created', { referenceId: result.referenceId })
      return {
        status: 201,
        body: {
          success: true,
          referenceId: result.referenceId,
        },
      }
    }

    logger.warn('Failed to create sandbox API user', { message: result.message })
    return {
      status: 409,
      body: {
        success: false,
        error: result.message || 'Failed to create API user',
      },
    }
  } catch (error: any) {
    logger.error('Error creating sandbox API user', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: error.message || 'Internal server error',
      },
    }
  }
}
