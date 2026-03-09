import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { env } from '../../config/env'
import bcrypt from 'bcryptjs'
import jsonwebtoken from 'jsonwebtoken'
import crypto from 'crypto'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
  businessName: z.string().min(1),
  phoneNumber: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'AuthRegister',
  flows: ['authentication'],
  type: 'api',
  path: '/api/v1/auth/register',
  method: 'POST',
  emits: ['user.registered'],
  bodySchema,
  middleware: [coreMiddleware],
  description: 'Register a new user account with a sandbox API key',
}

function generateSandboxApiKey(): string {
  const prefix = 'pk_test_'
  const randomBytes = crypto.randomBytes(32)
  const key = randomBytes
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 40)
  return `${prefix}${key}`
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { email, username, password, businessName, phoneNumber } = req.body as z.infer<typeof bodySchema>

    // Check if user exists by email or username
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    })

    if (existingUser) {
      const field = existingUser.email === email ? 'Email' : 'Username'
      return {
        status: 409,
        body: {
          statusCode: 409,
          error: 'Conflict',
          message: `${field} already exists`,
        },
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10)

    // Generate sandbox API key for immediate use
    const sandboxKey = generateSandboxApiKey()

    // Create user with settings and a default sandbox API key
    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        businessName,
        phoneNumber,
        settings: {
          create: {
            notificationEmail: email,
            enableEmail: true,
            enableSMS: false,
            timezone: 'Africa/Douala',
          },
        },
        apiKeys: {
          create: {
            key: sandboxKey,
            name: 'Default Sandbox Key',
            mode: 'SANDBOX' as any,
            isActive: true,
          },
        },
      },
      include: {
        settings: true,
        apiKeys: true,
      },
    })

    // Generate JWT token
    const token = jsonwebtoken.sign({ userId: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: '7d' })

    logger.info('New user registered with sandbox API key', { userId: user.id, email: user.email })

    await emit({
      topic: 'user.registered',
      data: { userId: user.id, email: user.email, businessName: user.businessName },
    })

    return {
      status: 201,
      body: {
        user: {
          id: user.id,
          email: user.email,
          businessName: user.businessName,
          createdAt: user.createdAt.toISOString(),
        },
        token,
        sandboxApiKey: {
          key: sandboxKey,
          name: 'Default Sandbox Key',
          mode: 'sandbox',
          message: 'Your sandbox API key for testing. Use X-API-Key header to authenticate requests. To go live, complete KYC verification and create a live API key.',
        },
      },
    }
  } catch (error: any) {
    logger.error('Error registering user', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to register user',
      },
    }
  }
}
