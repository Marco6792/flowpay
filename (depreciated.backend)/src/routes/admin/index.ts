import { FastifyInstance } from 'fastify';
import { feeRoutes } from './fee.routes.ts';
import { adminAuthRoutes } from './auth.routes.ts';

export async function adminRoutes(fastify: FastifyInstance) {
  // Admin authentication routes
  await fastify.register(adminAuthRoutes, { prefix: '/auth' });

  // Fee management routes
  await fastify.register(feeRoutes, { prefix: '/fees' });

  // Add other admin routes here as needed
  // await fastify.register(userRoutes, { prefix: '/users' });
  // await fastify.register(reportRoutes, { prefix: '/reports' });
  // await fastify.register(settingsRoutes, { prefix: '/settings' });
}
