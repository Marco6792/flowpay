import { FastifyInstance } from 'fastify';
import { AdminAuthController } from '../../controllers/admin-auth.controller.ts';
import { requireAdmin, requireSuperAdmin } from '../../middleware/admin.middleware.ts';

export async function adminAuthRoutes(fastify: FastifyInstance) {
  const adminAuthController = new AdminAuthController();

  // Public admin routes (no auth required)
  fastify.post(
    '/login',
    async (request, reply) => adminAuthController.login(request as any, reply)
  );

  // Protected admin routes
  fastify.get(
    '/me',
    {
      onRequest: [requireAdmin],
    },
    async (request, reply) => adminAuthController.getCurrentAdmin(request, reply)
  );

  // Super admin only
  fastify.post(
    '/create-admin',
    {
      onRequest: [requireSuperAdmin],
    },
    async (request, reply) => adminAuthController.createAdmin(request as any, reply)
  );
}
