import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { SandboxService } from '../../services/sandbox.service'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  referenceId: z.string().uuid('referenceId must be a valid UUID v4'),
})

export const config: ApiRouteConfig = {
  name: 'GetSandboxApiUser',
  flows: ['sandbox-provisioning'],
  type: 'api',
  path: '/api/v1/sandbox/apiuser/:referenceId',
  method: 'GET',
  middleware: [coreMiddleware],
  description: 'Get details of a sandbox API user (GET /v1_0/apiuser/{X-Reference-Id})',
  emits: [],
}

export const handler = async (req: any, { logger }: FlowContext<any>) => {
  try {
    let sandboxService: SandboxService
    try {
      sandboxService = new SandboxService()
    } catch {
      return {
        status: 403,
        body: {
          success: false,
          error: 'Sandbox provisioning is not available in production mode',
        },
      }
    }

    const parseResult = paramsSchema.safeParse(req.params)
    if (!parseResult.success) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'Invalid referenceId: must be a valid UUID v4',
        },
      }
    }

    const { referenceId } = parseResult.data

    const result = await sandboxService.getApiUser(referenceId)

    if (result.success) {
      logger.info('Sandbox API user retrieved', { referenceId })
      return {
        status: 200,
        body: {
          success: true,
          referenceId,
          providerCallbackHost: result.providerCallbackHost,
          targetEnvironment: result.targetEnvironment,
        },
      }
    }

    const isNotFound = result.message === 'API user not found'
    logger.warn('Sandbox API user not found or error', { referenceId, message: result.message })
    return {
      status: isNotFound ? 404 : 500,
      body: {
        success: false,
        error: result.message || 'API user not found',
      },
    }
  } catch (error: any) {
    logger.error('Error fetching sandbox API user', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: error.message || 'Internal server error',
      },
    }
  }
}
