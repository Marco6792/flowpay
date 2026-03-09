import { ApiRouteConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { jwtAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'AuthListApiKeys',
  flows: ['authentication'],
  type: 'api',
  path: '/api/v1/auth/api-keys',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, jwtAuth],
  description: 'List all API keys for the authenticated user',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const currentUser = req.user!

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: currentUser.userId },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastUsed: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { payments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const formattedKeys = apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      isActive: key.isActive,
      lastUsedAt: key.lastUsed?.toISOString(),
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
      paymentCount: key._count.payments,
    }))

    logger.info(
      'Listed API keys',
      {
        userId: currentUser.userId,
        keyCount: formattedKeys.length,
      }
    )

    return {
      status: 200,
      body: formattedKeys,
    }
  } catch (error: any) {
    logger.error('Error listing API keys', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to list API keys',
      },
    }
  }
}
