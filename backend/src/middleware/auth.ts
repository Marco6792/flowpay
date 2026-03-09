import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/database.ts';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: {
      id: string;
      name: string;
      userId: string;
    };
    user?: {
      userId: string;
      email: string;
    };
  }
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  console.log('🔐 AUTH PLUGIN BEING REGISTERED');

  // Decorate request with user and apiKey properties
  app.decorateRequest('apiKey', null);
  app.decorateRequest('user', null);

  // Use onRequest hook instead of preHandler to catch ALL requests
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('🚨 AUTH MIDDLEWARE ONREQUEST CALLED FOR:', request.method, request.url);
    logger.debug({ url: request.url, method: request.method }, 'Auth middleware onRequest called');
    const apiPrefix = process.env.API_PREFIX || '/api/v1';

    // Skip auth for public endpoints
    const publicPaths = [
      `${apiPrefix}/health`,
      `${apiPrefix}/auth/register`,
      `${apiPrefix}/auth/login`
    ];

    const isPublicPath = publicPaths.some(path =>
      request.url === path ||
      request.url.startsWith(path + '/') ||
      request.url.startsWith(path + '?')
    );

    if (isPublicPath) {
      return;
    }

    // Check if this is an API key management endpoint
    const isApiKeyEndpoint = request.url.startsWith(`${apiPrefix}/auth/api-keys`);

    logger.info({
      url: request.url,
      method: request.method,
      isApiKeyEndpoint,
      hasAuthHeader: !!request.headers.authorization,
      authHeaderValue: request.headers.authorization ? `${request.headers.authorization.substring(0, 20)}...` : 'none',
      hasApiKeyHeader: !!request.headers['x-api-key'],
      allHeaders: Object.keys(request.headers)
    }, 'Auth middleware processing request - DETAILED');

    // Try JWT authentication first
    const authHeader = request.headers.authorization;
    logger.info({
      authHeader: authHeader ? `${authHeader.substring(0, 30)}...` : 'none',
      startsWithBearer: authHeader ? authHeader.startsWith('Bearer ') : false
    }, 'Auth header check');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      logger.info({
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        tokenSuffix: '...' + token.substring(token.length - 10),
        path: request.url
      }, 'Attempting JWT verification with token');

      try {
        const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any;
        logger.debug({ decoded }, 'JWT decoded successfully');

        request.user = {
          userId: decoded.userId,
          email: decoded.email,
        };

        logger.info({
          userId: decoded.userId,
          email: decoded.email,
          path: request.url,
          userSet: !!request.user,
          requestUserAfterSet: request.user
        }, 'JWT auth successful - user set on request - RETURNING FROM MIDDLEWARE');
        return; // Authentication successful
      } catch (error: any) {
        logger.error({
          error: error.message,
          errorName: error.name,
          path: request.url,
          tokenLength: token.length,
          jwtSecret: env.JWT_SECRET ? 'present' : 'missing',
          isApiKeyEndpoint
        }, 'JWT verification failed - DETAILED ERROR');

        // For API key management endpoints, JWT is required
        if (isApiKeyEndpoint) {
          logger.error({ path: request.url, error: error.message }, 'Returning 401 for API key endpoint');
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: `JWT authentication required: ${error.message}`,
          });
        }
        // For other endpoints, fall through to API key check
      }
    } else {
      logger.info({
        authHeader: authHeader ? 'present but not Bearer' : 'not present',
        path: request.url
      }, 'No valid Bearer token found');
    }

    // If JWT auth failed or not provided, check for API key
    const apiKeyHeader = request.headers['x-api-key'] as string;

    // API key management endpoints require JWT, not API key
    if (isApiKeyEndpoint) {
      logger.warn({
        path: request.url,
        hasAuthHeader: !!authHeader,
        hasUser: !!request.user
      }, 'API key endpoint accessed without valid JWT');
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Bearer token required for API key management',
      });
    }

    // For other protected endpoints, require either JWT or API key
    if (!apiKeyHeader && !request.user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required (Bearer token or X-API-Key)',
      });
    }

    // Validate API key if provided and no JWT auth
    if (apiKeyHeader && !request.user) {
      try {
        const key = await prisma.apiKey.findUnique({
          where: {
            key: apiKeyHeader,
            isActive: true,
          },
          include: {
            user: true,
          }
        });

        if (!key) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid or inactive API key',
          });
        }

        // Update last used timestamp
        await prisma.apiKey.update({
          where: { id: key.id },
          data: { lastUsed: new Date() },
        });

        request.apiKey = {
          id: key.id,
          name: key.name,
          userId: key.userId,
        };

        // Also set user context from API key
        request.user = {
          userId: key.userId,
          email: key.user.email,
        };

        logger.info({ apiKeyName: key.name, userId: key.userId }, 'API key auth successful');
      } catch (error: any) {
        logger.error({ error }, 'Error validating API key');

        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error validating authentication',
        });
      }
    }
  });
}
