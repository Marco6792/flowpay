import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';

export interface AdminUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
}

/**
 * Middleware to check if user is an admin
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'Admin authentication required',
      });
    }

    const token = authHeader.substring(7);

    // Verify JWT token
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;

    // Check if user exists and is admin
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid authentication',
      });
    }

    // Check if user has admin role
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      logger.warn({
        userId: user.id,
        email: user.email,
        role: user.role,
        path: request.url,
      }, 'Non-admin user attempted to access admin endpoint');

      return reply.status(403).send({
        success: false,
        error: 'Admin access required',
      });
    }

    // Attach admin user to request
    (request as any).user = user;

    logger.info({
      adminId: user.id,
      email: user.email,
      path: request.url,
      method: request.method,
    }, 'Admin API access');

  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return reply.status(401).send({
        success: false,
        error: 'Invalid or expired token',
      });
    }

    logger.error({ error }, 'Admin authentication error');
    return reply.status(500).send({
      success: false,
      error: 'Authentication failed',
    });
  }
}

/**
 * Middleware to check if user is a super admin
 */
export async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // First check if admin
    await requireAdmin(request, reply);

    const user = (request as any).user;

    if (!user) {
      return;
    }

    // Check if super admin
    if (user.role !== 'SUPER_ADMIN') {
      logger.warn({
        userId: user.id,
        email: user.email,
        role: user.role,
        path: request.url,
      }, 'Admin attempted to access super admin endpoint');

      return reply.status(403).send({
        success: false,
        error: 'Super admin access required',
      });
    }

    logger.info({
      superAdminId: user.id,
      email: user.email,
      path: request.url,
      method: request.method,
    }, 'Super admin API access');

  } catch (error) {
    // Error already handled by requireAdmin
  }
}

/**
 * Check specific permissions for admin actions
 */
export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    if (!user) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
      });
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
      ADMIN: [
        'fees.view',
        'fees.assign',
        'users.view',
        'reports.view',
      ],
    };

    const userPermissions = permissions[user.role] || [];

    if (!userPermissions.includes(permission)) {
      logger.warn({
        userId: user.id,
        role: user.role,
        requiredPermission: permission,
        path: request.url,
      }, 'Permission denied');

      return reply.status(403).send({
        success: false,
        error: `Permission denied: ${permission}`,
      });
    }
  };
}
