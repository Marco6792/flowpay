import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../utils/database.ts';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

const adminLoginSchema = z.object({
  username: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6),
}).refine(data => data.username || data.email, {
  message: 'Either username or email must be provided',
});

export class AdminAuthController {
  /**
   * Admin login
   * POST /api/v1/admin/auth/login
   */
  async login(
    request: FastifyRequest<{ Body: { username?: string; email?: string; password: string } }>,
    reply: FastifyReply
  ) {
    try {
      const { username, email, password } = adminLoginSchema.parse(request.body);

      // Find user by username or email
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            email ? { email } : {},
            username ? { username } : {},
          ].filter(condition => Object.keys(condition).length > 0),
        },
      });

      if (!user) {
        logger.warn({ email, username }, 'Admin login attempt with invalid credentials');
        return reply.status(401).send({
          success: false,
          error: 'Invalid credentials',
        });
      }

      // Check if user is admin
      if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        logger.warn({
          userId: user.id,
          email: user.email,
          role: user.role
        }, 'Non-admin user attempted admin login');

        return reply.status(403).send({
          success: false,
          error: 'Admin access required',
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        logger.warn({ userId: user.id }, 'Admin login with invalid password');
        return reply.status(401).send({
          success: false,
          error: 'Invalid credentials',
        });
      }

      // Check if account is verified
      if (!user.isVerified) {
        return reply.status(403).send({
          success: false,
          error: 'Account is not verified',
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
          type: 'admin',
        },
        env.JWT_SECRET,
        { expiresIn: '8h' } // Admin tokens expire in 8 hours
      );

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      logger.info({
        userId: user.id,
        email: user.email,
        role: user.role,
      }, 'Admin login successful');

      return reply.send({
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
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Admin login error');
      return reply.status(500).send({
        success: false,
        error: 'Login failed',
      });
    }
  }

  /**
   * Get current admin user
   * GET /api/v1/admin/auth/me
   */
  async getCurrentAdmin(request: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (request as any).user;

      if (!user) {
        return reply.status(401).send({
          success: false,
          error: 'Not authenticated',
        });
      }

      // Get full user details
      const adminUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          businessName: true,
          role: true,
          isVerified: true,
          createdAt: true,
          lastLoginAt: true,
        },
      });

      return reply.send({
        success: true,
        data: adminUser,
      });
    } catch (error) {
      logger.error({ error }, 'Error getting current admin');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get user info',
      });
    }
  }

  /**
   * Create admin user (Super Admin only)
   * POST /api/v1/admin/auth/create-admin
   */
  async createAdmin(
    request: FastifyRequest<{
      Body: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        role: 'ADMIN' | 'SUPER_ADMIN';
      };
    }>,
    reply: FastifyReply
  ) {
    try {
      const currentUser = (request as any).user;

      // Check if current user is super admin
      if (currentUser.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({
          success: false,
          error: 'Only super admins can create other admins',
        });
      }

      const { email, password, role } = request.body;
      const businessName = (request.body as any).businessName || 'Admin Business';

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return reply.status(409).send({
          success: false,
          error: 'Email already registered',
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

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
      });

      logger.info({
        adminId: newAdmin.id,
        email: newAdmin.email,
        role: newAdmin.role,
        createdBy: currentUser.id,
      }, 'New admin user created');

      return reply.status(201).send({
        success: true,
        data: newAdmin,
      });
    } catch (error) {
      logger.error({ error }, 'Error creating admin');
      return reply.status(500).send({
        success: false,
        error: 'Failed to create admin',
      });
    }
  }
}
