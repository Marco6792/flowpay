import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/database.ts';
import bcrypt from 'bcrypt';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';
import crypto from 'crypto';

interface RegisterBody {
  email: string;
  username: string;
  password: string;
  businessName: string;
  phoneNumber?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface CreateApiKeyBody {
  name: string;
}

export class AuthController {
  /**
   * Register a new user
   */
  async register(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { email, username, password, businessName, phoneNumber } = request.body as RegisterBody;

      // Check if user exists by email or username
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email },
            { username },
          ],
        },
      });

      if (existingUser) {
        const field = existingUser.email === email ? 'Email' : 'Username';
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `${field} already exists`,
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user with settings
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
        },
        include: {
          settings: true,
        },
      });

      // Generate JWT token
      const token = jsonwebtoken.sign(
        { userId: user.id, email: user.email },
        env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      logger.info({ userId: user.id, email: user.email }, 'New user registered');

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          businessName: user.businessName,
          createdAt: user.createdAt.toISOString(),
        },
        token,
      });
    } catch (error) {
      logger.error({ error }, 'Error registering user');
      throw error;
    }
  }

  /**
   * Login user
   */
  async login(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { email, password } = request.body as LoginBody;

      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
        });
      }

      // Generate JWT token
      const token = jsonwebtoken.sign(
        { userId: user.id, email: user.email },
        env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      logger.info({ userId: user.id, email: user.email }, 'User logged in');

      return {
        user: {
          id: user.id,
          email: user.email,
          businessName: user.businessName,
          isVerified: user.isVerified,
        },
        token,
      };
    } catch (error) {
      logger.error({ error }, 'Error logging in user');
      throw error;
    }
  }

  /**
   * Create API key
   */
  async createApiKey(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { name } = request.body as CreateApiKeyBody;
      const currentUser = request.user;

      logger.info({
        user: currentUser,
        userDefined: currentUser !== undefined,
        userNull: currentUser === null,
        requestKeys: Object.keys(request),
        headers: request.headers.authorization ? 'Bearer token present' : 'No auth header',
        url: request.url
      }, 'Creating API key - detailed debug');

      if (!currentUser) {
        logger.error({
          user: currentUser,
          userType: typeof currentUser,
          requestHasUser: 'user' in request,
          requestUserValue: request.user
        }, 'No user found on request in createApiKey - detailed debug');
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Check how many active API keys the user has
      const activeKeyCount = await prisma.apiKey.count({
        where: {
          userId: currentUser.userId,
          isActive: true,
        },
      });

      // Limit to 10 active API keys per user
      if (activeKeyCount >= 10) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Maximum number of active API keys (10) reached. Please revoke an existing key.',
        });
      }

      // Generate secure API key
      const key = this.generateApiKey();

      // Create API key
      const newApiKey = await prisma.apiKey.create({
        data: {
          key,
          name,
          userId: currentUser.userId,
          isActive: true,
        },
      });

      logger.info({
        apiKeyId: newApiKey.id,
        userId: currentUser.userId,
        name: newApiKey.name
      }, 'API key created successfully');

      return reply.status(201).send({
        id: newApiKey.id,
        key: newApiKey.key,
        name: newApiKey.name,
        createdAt: newApiKey.createdAt.toISOString(),
        message: 'API key created successfully. Please store it securely as it will not be shown again.',
      });
    } catch (error) {
      logger.error({ error }, 'Error creating API key');
      throw error;
    }
  }

  /**
   * List API keys
   */
  async listApiKeys(request: FastifyRequest, reply: FastifyReply) {
    try {
      const currentUser = request.user;

      if (!currentUser) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      const apiKeys = await prisma.apiKey.findMany({
        where: { userId: currentUser.userId },
        select: {
          id: true,
          name: true,
          isActive: true,
          lastUsed: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { payments: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formattedKeys = apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        isActive: key.isActive,
        lastUsedAt: key.lastUsed?.toISOString(),
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
        paymentCount: key._count.payments,
      }));

      logger.info({
        userId: currentUser.userId,
        keyCount: formattedKeys.length
      }, 'Listed API keys');

      return formattedKeys;
    } catch (error) {
      logger.error({ error }, 'Error listing API keys');
      throw error;
    }
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const currentUser = request.user;

      if (!currentUser) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Check if API key belongs to user
      const targetApiKey = await prisma.apiKey.findFirst({
        where: {
          id,
          userId: currentUser.userId,
        },
      });

      if (!targetApiKey) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'API key not found',
        });
      }

      if (!targetApiKey.isActive) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'API key is already revoked',
        });
      }

      // Revoke API key
      await prisma.apiKey.update({
        where: { id },
        data: { isActive: false },
      });

      logger.info({
        apiKeyId: id,
        userId: currentUser.userId,
        name: targetApiKey.name
      }, 'API key revoked');

      return {
        message: 'API key revoked successfully',
        revokedKey: {
          id: targetApiKey.id,
          name: targetApiKey.name,
        }
      };
    } catch (error) {
      logger.error({ error }, 'Error revoking API key');
      throw error;
    }
  }

  /**
   * Generate a secure API key
   */
  private generateApiKey(): string {
    const prefix = 'pk_live_';
    const randomBytes = crypto.randomBytes(32);
    const key = randomBytes.toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 40);
    return `${prefix}${key}`;
  }
}
