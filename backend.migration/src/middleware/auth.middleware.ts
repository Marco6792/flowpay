import { ApiMiddleware } from 'motia'
import { prisma } from '../utils/database'
import { env } from '../config/env'
import jsonwebtoken from 'jsonwebtoken'

/**
 * JWT Authentication Middleware
 * Requires a valid Bearer token in the Authorization header
 */
export const jwtAuth: ApiMiddleware<any> = async (req: any, ctx, next) => {
  const { logger } = ctx
  const authHeader = req.headers.authorization as string | undefined

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('JWT auth failed: No Bearer token')
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        message: 'Bearer token required',
      },
    }
  }

  try {
    const token = authHeader.substring(7)
    const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    }

    logger.debug('JWT auth successful', { userId: decoded.userId })
    return next()
  } catch (error: any) {
    logger.error('JWT verification failed', { error: error.message })
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        message: `Invalid or expired token: ${error.message}`,
      },
    }
  }
}

/**
 * API Key Authentication Middleware
 * Requires a valid X-API-Key header
 */
export const apiKeyAuth: ApiMiddleware<any> = async (req: any, ctx, next) => {
  const { logger } = ctx
  const apiKeyHeader = req.headers['x-api-key'] as string

  if (!apiKeyHeader) {
    logger.warn('API key auth failed: No X-API-Key header')
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        message: 'X-API-Key header required',
      },
    }
  }

  try {
    const key = await prisma.apiKey.findUnique({
      where: {
        key: apiKeyHeader,
        isActive: true,
      },
      include: {
        user: true,
      },
    })

    if (!key) {
      logger.warn('API key auth failed: Invalid or inactive key')
      return {
        status: 401,
        body: {
          error: 'Unauthorized',
          message: 'Invalid or inactive API key',
        },
      }
    }

    // Update last used timestamp (fire and forget)
    prisma.apiKey
      .update({
        where: { id: key.id },
        data: { lastUsed: new Date() },
      })
      .catch((err: any) => logger.error('Failed to update API key lastUsed', { error: err }))

    req.apiKey = {
      id: key.id,
      name: key.name,
      userId: key.userId,
      mode: key.mode,  // 'SANDBOX' | 'LIVE'
    }

    req.user = {
      userId: key.userId,
      email: key.user.email,
    }

    logger.info('API key auth successful', { apiKeyName: key.name, userId: key.userId, mode: key.mode })
    return next()
  } catch (error: any) {
    logger.error('API key validation error', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Error validating API key',
      },
    }
  }
}

/**
 * Optional Authentication Middleware
 * Attempts JWT auth but doesn't reject if missing (for consent endpoints)
 */
export const optionalAuth: ApiMiddleware<any> = async (req: any, ctx, next) => {
  const { logger } = ctx
  const authHeader = req.headers.authorization as string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7)
      const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
      }
      logger.debug('Optional auth: JWT found', { userId: decoded.userId })
    } catch (error) {
      logger.debug('Optional auth: JWT invalid but continuing')
    }
  }

  return next()
}

/**
 * Either JWT or API Key Authentication Middleware
 * Accepts either Bearer token or X-API-Key header
 */
export const eitherAuth: ApiMiddleware<any> = async (req: any, ctx, next) => {
  const { logger } = ctx
  const authHeader = req.headers.authorization as string | undefined
  const apiKeyHeader = req.headers['x-api-key'] as string

  // Try JWT first
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7)
      const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
      }
      logger.debug('Either auth: JWT successful', { userId: decoded.userId })
      return next()
    } catch (error) {
      // JWT failed, try API key
      logger.debug('Either auth: JWT failed, trying API key')
    }
  }

  // Try API key
  if (apiKeyHeader) {
    try {
      const key = await prisma.apiKey.findUnique({
        where: {
          key: apiKeyHeader,
          isActive: true,
        },
        include: {
          user: true,
        },
      })

      if (key) {
        // Update last used
        prisma.apiKey
          .update({
            where: { id: key.id },
            data: { lastUsed: new Date() },
          })
          .catch((err: any) => logger.error('Failed to update API key lastUsed', { error: err }))

        req.apiKey = {
          id: key.id,
          name: key.name,
          userId: key.userId,
          mode: key.mode,  // 'SANDBOX' | 'LIVE'
        }

        req.user = {
          userId: key.userId,
          email: key.user.email,
        }

        logger.info('Either auth: API key successful', { apiKeyName: key.name, mode: key.mode })
        return next()
      }
    } catch (error: any) {
      logger.error('Either auth: API key error', { error: error.message })
    }
  }

  // Both failed
  logger.warn('Either auth failed: No valid JWT or API key')
  return {
    status: 401,
    body: {
      error: 'Unauthorized',
      message: 'Authentication required (Bearer token or X-API-Key)',
    },
  }
}
