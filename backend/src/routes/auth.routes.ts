import { FastifyInstance } from 'fastify';
import { AuthController } from '../controllers/auth.controller.ts';

const authController = new AuthController();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Public routes (no auth required)
  app.post('/auth/register', (request, reply) => authController.register(request, reply));
  app.post('/auth/login', (request, reply) => authController.login(request, reply));

  // Protected routes (auth middleware runs globally)
  app.post('/auth/api-keys', (request, reply) => authController.createApiKey(request, reply));
  app.get('/auth/api-keys', (request, reply) => authController.listApiKeys(request, reply));
  app.delete('/auth/api-keys/:id', (request, reply) => authController.revokeApiKey(request, reply));
}
