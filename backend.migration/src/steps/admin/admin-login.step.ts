import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { coreMiddleware } from '../../middlewares/core.middleware'
import bcrypt from 'bcryptjs'
import jsonwebtoken from 'jsonwebtoken'
import { env } from '../../config/env'

const bodySchema = z
  .object({
    username: z.string().optional(),
    email: z.string().email().optional(),
    password: z.string().min(6),
  })
  .refine((data) => data.username || data.email, {
    message: 'Either username or email must be provided',
  })

export const config: ApiRouteConfig = {
  name: 'AdminLogin',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/auth/login',
  method: 'POST',
  emits: ['admin.logged_in'],
  bodySchema,
  middleware: [coreMiddleware],
  description: 'Admin login with username or email',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { username, email, password } = req.body as z.infer<typeof bodySchema>

    // Find user by username or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [email ? { email } : {}, username ? { username } : {}].filter(
          (condition) => Object.keys(condition).length > 0
        ),
      },
    })

    if (!user) {
      logger.warn('Admin login attempt with invalid credentials', { email, username })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Invalid credentials',
        },
      }
    }

    // Check if user is admin
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      logger.warn(
        'Non-admin user attempted admin login',
        {
          userId: user.id,
          email: user.email,
          role: user.role,
        }
      )

      return {
        status: 403,
        body: {
          success: false,
          error: 'Admin access required',
        },
      }
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash)

    if (!isValidPassword) {
      logger.warn('Admin login with invalid password', { userId: user.id })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Invalid credentials',
        },
      }
    }

    // Check if account is verified
    if (!user.isVerified) {
      return {
        status: 403,
        body: {
          success: false,
          error: 'Account is not verified',
        },
      }
    }

    // Generate JWT token
    const token = jsonwebtoken.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        type: 'admin',
      },
      env.JWT_SECRET,
      { expiresIn: '8h' } // Admin tokens expire in 8 hours
    )

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    logger.info(
      'Admin login successful',
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      }
    )

    await emit({
      topic: 'admin.logged_in',
      data: { userId: user.id, email: user.email, role: user.role },
    })

    return {
      status: 200,
      body: {
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.businessName,
            role: user.role,
          },
        },
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

    logger.error('Admin login error', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Login failed',
      },
    }
  }
}
