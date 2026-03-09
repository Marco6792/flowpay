import { FastifyInstance } from 'fastify';
import { prisma, PrismaService } from '../utils/database.ts';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request, reply) => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  app.get('/health/ready', async (request, reply) => {
    const isConnected = await PrismaService.checkConnection();

    if (isConnected) {
      return {
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } else {
      reply.status(503);
      return {
        status: 'not ready',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  });
}
