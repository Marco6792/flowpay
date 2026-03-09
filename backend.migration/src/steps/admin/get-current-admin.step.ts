import { ApiRouteConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'

export const config: ApiRouteConfig = {
  name: 'GetCurrentAdmin',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/auth/me',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, requireAdmin],
  description: 'Get current admin user information',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const user = req.user

    if (!user) {
      return {
        status: 401,
        body: {
          success: false,
          error: 'Not authenticated',
        },
      }
    }

    // Get full user details
    const adminUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        email: true,
        businessName: true,
        role: true,
        isVerified: true,
        createdAt: true,
        lastLoginAt: true,
      },
    })

    return {
      status: 200,
      body: {
        success: true,
        data: adminUser,
      },
    }
  } catch (error: any) {
    logger.error('Error getting current admin', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to get user info',
      },
    }
  }
}
