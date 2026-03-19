import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { requireAdmin } from '../../middleware/admin.middleware'
import bcrypt from 'bcryptjs'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  businessName: z.string().optional(),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']),
})

export const config: ApiRouteConfig = {
  name: 'CreateAdmin',
  flows: ['admin-management'],
  type: 'api',
  path: '/api/v1/admin/auth/create-admin',
  method: 'POST',
  emits: ['admin.created'],
  bodySchema,
  middleware: [coreMiddleware, requireAdmin],
  description: 'Create a new admin user (Super Admin only)',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const currentUser = req.user

    // Check if current user is super admin
    if (currentUser?.role !== 'SUPER_ADMIN') {
      return {
        status: 403,
        body: {
          success: false,
          error: 'Only super admins can create other admins',
        },
      }
    }

    const { email, password, role, businessName } = req.body as z.infer<typeof bodySchema>

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return {
        status: 409,
        body: {
          success: false,
          error: 'Email already registered',
        },
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10)

    // Create admin user
    const newAdmin = await prisma.user.create({
      data: {
        email,
        username: email.split('@')[0], // Use email prefix as username
        passwordHash,
        businessName: businessName || 'FlowPay Admin',
        role,
        isVerified: true, // Admins are pre-verified
        businessType: 'ADMIN',
      },
      select: {
        id: true,
        email: true,
        username: true,
        businessName: true,
        role: true,
        createdAt: true,
      },
    })

    logger.info(
      'New admin user created',
      {
        adminId: newAdmin.id,
        email: newAdmin.email,
        role: newAdmin.role,
        createdBy: currentUser.userId,
      }
    )

    await emit({
      topic: 'admin.created',
      data: { adminId: newAdmin.id, email: newAdmin.email, role: newAdmin.role, createdBy: currentUser.userId },
    })

    return {
      status: 201,
      body: {
        success: true,
        data: newAdmin,
      },
    }
  } catch (error: any) {
    logger.error('Error creating admin', { error })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Failed to create admin',
      },
    }
  }
}
