import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { jwtAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const paramsSchema = z.object({
  id: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'AuthRevokeApiKey',
  flows: ['authentication'],
  type: 'api',
  path: '/api/v1/auth/api-keys/:id',
  method: 'DELETE',
  emits: ['apikey.revoked'],
  middleware: [coreMiddleware, jwtAuth],
  description: 'Revoke an API key',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const currentUser = req.user!

    // Check if API key belongs to user
    const targetApiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        userId: currentUser.userId,
      },
    })

    if (!targetApiKey) {
      return {
        status: 404,
        body: {
          statusCode: 404,
          error: 'Not Found',
          message: 'API key not found',
        },
      }
    }

    if (!targetApiKey.isActive) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'API key is already revoked',
        },
      }
    }

    // Revoke API key
    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    })

    logger.info(
      'API key revoked',
      {
        apiKeyId: id,
        userId: currentUser.userId,
        name: targetApiKey.name,
      }
    )

    await emit({
      topic: 'apikey.revoked',
      data: { apiKeyId: id, userId: currentUser.userId, name: targetApiKey.name },
    })

    return {
      status: 200,
      body: {
        message: 'API key revoked successfully',
        revokedKey: {
          id: targetApiKey.id,
          name: targetApiKey.name,
        },
      },
    }
  } catch (error: any) {
    logger.error('Error revoking API key', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to revoke API key',
      },
    }
  }
}
