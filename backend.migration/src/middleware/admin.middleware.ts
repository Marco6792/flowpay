import { ApiMiddleware } from 'motia'
import { prisma } from '../utils/database'
import { env } from '../config/env'
import jsonwebtoken from 'jsonwebtoken'

/**
 * Admin Authentication Middleware
 * Requires a valid Bearer token and user must have ADMIN or SUPER_ADMIN role
 */
export const requireAdmin: ApiMiddleware<any> = async (req: any, ctx, next) => {
  const { logger } = ctx
  const authHeader = req.headers.authorization as string | undefined

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Admin auth failed: No Bearer token')
    return {
      status: 401,
      body: {
        success: false,
        error: 'Admin authentication required',
      },
    }
  }

  try {
    const token = authHeader.substring(7)
    const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any

    // Fetch user and check role
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    })

    if (!user) {
      logger.warn('Admin auth failed: User not found', { userId: decoded.userId })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Invalid authentication',
        },
      }
    }

    // Check if user has admin role
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      logger.warn('Non-admin user attempted to access admin endpoint', {
        userId: user.id,
        email: user.email,
        role: user.role,
      })

      return {
        status: 403,
        body: {
          success: false,
          error: 'Admin access required',
        },
      }
    }

    // Attach admin user to request
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    }

    logger.info('Admin API access', {
      adminId: user.id,
      email: user.email,
      role: user.role,
    })

    return next()
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logger.warn('Admin auth failed: Invalid token', { error: error.message })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Invalid or expired token',
        },
      }
    }

    logger.error('Admin authentication error', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Authentication failed',
      },
    }
  }
}

/**
 * Super Admin Authentication Middleware
 * Requires a valid Bearer token and user must have SUPER_ADMIN role
 */
export const requireSuperAdmin: ApiMiddleware<any> = async (req: any, ctx, next) => {
  const { logger } = ctx
  const authHeader = req.headers.authorization as string | undefined

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Super admin auth failed: No Bearer token')
    return {
      status: 401,
      body: {
        success: false,
        error: 'Super admin authentication required',
      },
    }
  }

  try {
    const token = authHeader.substring(7)
    const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any

    // Fetch user and check role
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    })

    if (!user) {
      logger.warn('Super admin auth failed: User not found', { userId: decoded.userId })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Invalid authentication',
        },
      }
    }

    // Check if user has super admin role
    if (user.role !== 'SUPER_ADMIN') {
      logger.warn('User attempted to access super admin endpoint', {
        userId: user.id,
        email: user.email,
        role: user.role,
      })

      return {
        status: 403,
        body: {
          success: false,
          error: 'Super admin access required',
        },
      }
    }

    // Attach super admin user to request
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    }

    logger.info('Super admin API access', {
      superAdminId: user.id,
      email: user.email,
    })

    return next()
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logger.warn('Super admin auth failed: Invalid token', { error: error.message })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Invalid or expired token',
        },
      }
    }

    logger.error('Super admin authentication error', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Authentication failed',
      },
    }
  }
}

/**
 * Permission-based middleware factory
 * Creates middleware that checks for specific permissions
 */
export function requirePermission(permission: string): ApiMiddleware<any> {
  return async (req: any, ctx, next) => {
    const { logger } = ctx
    if (!req.user) {
      logger.warn('Permission check failed: No user', { permission })
      return {
        status: 401,
        body: {
          success: false,
          error: 'Authentication required',
        },
      }
    }

    // Define permissions for each role
    const permissions: Record<string, string[]> = {
      SUPER_ADMIN: [
        'fees.create',
        'fees.update',
        'fees.delete',
        'fees.assign',
        'users.manage',
        'settings.manage',
        'reports.view',
        'reports.export',
      ],
      ADMIN: ['fees.view', 'fees.assign', 'users.view', 'reports.view'],
    }

    const userRole = req.user.role || 'USER'
    const userPermissions = permissions[userRole] || []

    if (!userPermissions.includes(permission)) {
      logger.warn('Permission denied', {
        userId: req.user.userId,
        role: userRole,
        requiredPermission: permission,
      })

      return {
        status: 403,
        body: {
          success: false,
          error: `Permission denied: ${permission}`,
        },
      }
    }

    logger.debug('Permission check passed', {
      userId: req.user.userId,
      role: userRole,
      permission,
    })

    return next()
  }
}
