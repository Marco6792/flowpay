import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { SandboxService } from '../../services/sandbox.service'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  referenceId: z.string().uuid('referenceId must be a valid UUID v4'),
})

export const config: ApiRouteConfig = {
  name: 'CreateSandboxApiKey',
  flows: ['sandbox-provisioning'],
  type: 'api',
  path: '/api/v1/sandbox/apiuser/:referenceId/apikey',
  method: 'POST',
  middleware: [coreMiddleware],
  description: 'Generate an API key for a sandbox API user (POST /v1_0/apiuser/{X-Reference-Id}/apikey)',
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

    const result = await sandboxService.createApiKey(referenceId)

    if (result.success && result.apiKey) {
      logger.info('Sandbox API key created', { referenceId })
      return {
        status: 201,
        body: {
          success: true,
          referenceId,
          apiKey: result.apiKey,
        },
      }
    }

    logger.warn('Failed to create sandbox API key', { referenceId, message: result.message })
    return {
      status: result.notFound ? 404 : 400,
      body: {
        success: false,
        error: result.message || 'Failed to create API key',
      },
    }
  } catch (error: any) {
    logger.error('Error creating sandbox API key', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: error.message || 'Internal server error',
      },
    }
  }
}
