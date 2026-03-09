import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { jwtAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import crypto from 'crypto'

const bodySchema = z.object({
  name: z.string().min(1),
  mode: z.enum(['sandbox', 'live']).default('sandbox'),
})

export const config: ApiRouteConfig = {
  name: 'AuthCreateApiKey',
  flows: ['authentication'],
  type: 'api',
  path: '/api/v1/auth/api-keys',
  method: 'POST',
  emits: ['apikey.created'],
  bodySchema,
  middleware: [coreMiddleware, jwtAuth],
  description: 'Create a new API key (sandbox or live mode)',
}

function generateApiKey(mode: 'sandbox' | 'live'): string {
  const prefix = mode === 'live' ? 'pk_live_' : 'pk_test_'
  const randomBytes = crypto.randomBytes(32)
  const key = randomBytes
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 40)
  return `${prefix}${key}`
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { name, mode } = req.body as z.infer<typeof bodySchema>
    const currentUser = req.user!

    // Gate live keys: require KYC verification
    if (mode === 'live') {
      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
        select: { kycStatus: true, isVerified: true },
      })

      if (!user || user.kycStatus !== 'VERIFIED') {
        return {
          status: 403,
          body: {
            statusCode: 403,
            error: 'Forbidden',
            message: 'Live API keys require a verified account. Complete KYC verification first.',
            kycStatus: user?.kycStatus || 'UNKNOWN',
          },
        }
      }
    }

    // Check how many active API keys the user has
    const activeKeyCount = await prisma.apiKey.count({
      where: {
        userId: currentUser.userId,
        isActive: true,
      },
    })

    // Limit to 10 active API keys per user
    if (activeKeyCount >= 10) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Maximum number of active API keys (10) reached. Please revoke an existing key.',
        },
      }
    }

    // Generate secure API key with mode-aware prefix
    const key = generateApiKey(mode)
    const dbMode = mode === 'live' ? 'LIVE' : 'SANDBOX'

    // Create API key
    const newApiKey = await prisma.apiKey.create({
      data: {
        key,
        name,
        mode: dbMode as any,
        userId: currentUser.userId,
        isActive: true,
      },
    })

    logger.info(
      'API key created successfully',
      {
        apiKeyId: newApiKey.id,
        userId: currentUser.userId,
        name: newApiKey.name,
        mode: dbMode,
      }
    )

    await emit({
      topic: 'apikey.created',
      data: { apiKeyId: newApiKey.id, userId: currentUser.userId, name: newApiKey.name, mode: dbMode },
    })

    return {
      status: 201,
      body: {
        id: newApiKey.id,
        key: newApiKey.key,
        name: newApiKey.name,
        mode: mode,
        createdAt: newApiKey.createdAt.toISOString(),
        message: `${mode === 'live' ? 'Live' : 'Sandbox'} API key created successfully. Please store it securely as it will not be shown again.`,
      },
    }
  } catch (error: any) {
    logger.error('Error creating API key', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to create API key',
      },
    }
  }
}
