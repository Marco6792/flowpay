import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { env } from '../../config/env'
import bcrypt from 'bcryptjs'
import jsonwebtoken from 'jsonwebtoken'
import { coreMiddleware } from '../../middlewares/core.middleware'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'AuthLogin',
  flows: ['authentication'],
  type: 'api',
  path: '/api/v1/auth/login',
  method: 'POST',
  emits: ['user.logged_in'],
  bodySchema,
  middleware: [coreMiddleware],
  description: 'Login with email and password',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { email, password } = req.body as z.infer<typeof bodySchema>

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    })

    if (!user) {
      return {
        status: 401,
        body: {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        },
      }
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash)

    if (!isValidPassword) {
      return {
        status: 401,
        body: {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        },
      }
    }

    // Generate JWT token
    const token = jsonwebtoken.sign({ userId: user.id, email: user.email }, env.JWT_SECRET, { expiresIn: '7d' })

    logger.info('User logged in', { userId: user.id, email: user.email })

    await emit({
      topic: 'user.logged_in',
      data: { userId: user.id, email: user.email },
    })

    return {
      status: 200,
      body: {
        user: {
          id: user.id,
          email: user.email,
          businessName: user.businessName,
          isVerified: user.isVerified,
        },
        token,
      },
    }
  } catch (error: any) {
    logger.error('Error logging in user', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to login',
      },
    }
  }
}
