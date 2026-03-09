import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import { env } from './config/env.ts';
import { errorHandler } from './utils/errorHandler.ts';
import { authPlugin } from './middleware/auth.ts';
import { registerRoutes } from './routes/index.ts';
import jsonwebtoken from 'jsonwebtoken';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname,reqId',
          colorize: true,
          singleLine: true,
        },
      } : undefined,
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            path: request.routerPath,
            parameters: request.params,
          };
        },
      },
    },
    trustProxy: true,
    disableRequestLogging: true,  // Disable default request logging
  });

  // Add request/response logging hook
  app.addHook('onResponse', async (request, reply) => {
    const responseTime = reply.elapsedTime.toFixed(2);
    request.log.info(
      `${request.method} ${request.url} - ${reply.statusCode} - ${responseTime}ms`
    );
  });

  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
  });

  // Register form body parser for application/x-www-form-urlencoded
  await app.register(formbody);

  // Register auth middleware globally - DIRECT APPROACH
  console.log('📝 REGISTERING AUTH MIDDLEWARE DIRECTLY IN APP.TS');

  // Decorate request with user and apiKey properties
  app.decorateRequest('apiKey', null);
  app.decorateRequest('user', null);

  // Add auth hook directly to main app
  app.addHook('preHandler', async (request, reply) => {
    console.log('🚨 DIRECT AUTH MIDDLEWARE CALLED FOR:', request.method, request.url);

    const apiPrefix = process.env.API_PREFIX || '/api/v1';

    // Skip auth for public endpoints
    const publicPaths = [
      `${apiPrefix}/health`,
      `${apiPrefix}/auth/register`,
      `${apiPrefix}/auth/login`,
      `${apiPrefix}/webhooks/mtn`,     // MTN incoming webhooks
      `${apiPrefix}/webhooks/orange`,  // Orange incoming webhooks  
      `${apiPrefix}/webhooks/test`,    // Test webhook endpoint
      `${apiPrefix}/webhooks/provider` // Generic provider webhooks
    ];
    
    // Special case: generic webhook endpoint for internal notifications
    const isGenericWebhook = request.url === `${apiPrefix}/webhooks`;
    if (isGenericWebhook) {
      return; // Allow without auth
    }

    const isPublicPath = publicPaths.some(path =>
      request.url === path ||
      request.url.startsWith(path + '/') ||
      request.url.startsWith(path + '?')
    );

    if (isPublicPath) {
      console.log('⚪ Skipping auth for public path:', request.url);
      return;
    }

    // Check if this is an API key management endpoint
    const isApiKeyEndpoint = request.url.startsWith(`${apiPrefix}/auth/api-keys`);

    console.log('🔍 Auth check for:', request.url, 'isApiKeyEndpoint:', isApiKeyEndpoint);

    // Try JWT authentication first
    const authHeader = request.headers.authorization;
    console.log('🔑 Auth header:', authHeader ? `${authHeader.substring(0, 30)}...` : 'none');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      console.log('🎫 Token found, length:', token.length);

      try {
        const decoded = jsonwebtoken.verify(token, env.JWT_SECRET) as any;
        console.log('✅ JWT decoded successfully:', decoded.userId, decoded.email);

        request.user = {
          userId: decoded.userId,
          email: decoded.email,
        };

        console.log('👤 User set on request:', request.user);
        return; // Authentication successful
      } catch (error: any) {
        console.log('❌ JWT verification failed:', error.message);

        // For API key management endpoints, JWT is required
        if (isApiKeyEndpoint) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: `JWT authentication required: ${error.message}`,
          });
        }
      }
    } else {
      console.log('❌ No valid Bearer token found');

      if (isApiKeyEndpoint) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Bearer token required for API key management',
        });
      }
    }

    // If JWT auth failed or not provided, check for API key
    const apiKeyHeader = request.headers['x-api-key'] as string;
    console.log('🔑 API Key header:', apiKeyHeader ? `${apiKeyHeader.substring(0, 20)}...` : 'none');

    // API key management endpoints require JWT, not API key
    if (isApiKeyEndpoint) {
      console.log('⚠️ API key endpoint accessed without JWT');
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Bearer token required for API key management',
      });
    }

    // For other protected endpoints, require either JWT or API key
    if (!apiKeyHeader && !request.user) {
      console.log('❌ No authentication provided');
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required (Bearer token or X-API-Key)',
      });
    }

    // Validate API key if provided and no JWT auth
    if (apiKeyHeader && !request.user) {
      console.log('🔍 Validating API key...');
      try {
        const { prisma } = await import('./utils/database.ts');

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
          console.log('❌ Invalid or inactive API key');
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

        console.log('✅ API key auth successful:', key.name, 'for user:', key.userId);
      } catch (error: any) {
        console.log('❌ Error validating API key:', error.message);

        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Error validating authentication',
        });
      }
    }
  });

  console.log('✅ DIRECT AUTH MIDDLEWARE REGISTERED IN APP.TS');

  // Register routes (auth middleware will run globally)
  console.log('📝 REGISTERING ROUTES IN APP.TS');
  await app.register(registerRoutes);
  console.log('✅ ROUTES REGISTERED IN APP.TS');

  return app;
}

// Export a singleton app instance for testing
export const app = await buildApp();
