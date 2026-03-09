import { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.routes.ts';
import { paymentRoutes } from './payment.routes.ts';
import { transferRoutes } from './transfer.routes.ts';
import { withdrawalRoutes } from './withdrawal.routes.ts';
import { consentRoutes } from './consent.routes.ts';
import { authRoutes } from './auth.routes.ts';
import { webhookRoutes } from './webhook.routes.ts';
import { preApprovalRoutes } from './preapproval.routes.ts';
import { balanceRoutes } from './balance.routes.ts';
import { adminRoutes } from './admin/index.ts';
import { env } from '../config/env.ts';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Root API route
  app.get(env.API_PREFIX, async () => {
    return {
      name: 'FlowPay Payment Gateway API',
      version: '1.0.0',
      description: 'Revolutionary "counting to five" payment API for Cameroon',
      endpoints: {
        health: `${env.API_PREFIX}/health`,
        payments: `${env.API_PREFIX}/payments`,
        transfers: `${env.API_PREFIX}/transfers`,
        withdrawals: `${env.API_PREFIX}/withdrawals`,
        preapprovals: `${env.API_PREFIX}/preapprovals`,
        balance: `${env.API_PREFIX}/balance`,
        consent: `${env.API_PREFIX}/consent`,
        auth: `${env.API_PREFIX}/auth`,
        webhooks: `${env.API_PREFIX}/webhooks`,
      },
    };
  });

  // Register all route modules
  await app.register(healthRoutes, { prefix: env.API_PREFIX });
  await app.register(authRoutes, { prefix: env.API_PREFIX });
  await app.register(paymentRoutes, { prefix: env.API_PREFIX });
  await app.register(transferRoutes, { prefix: env.API_PREFIX });
  await app.register(withdrawalRoutes, { prefix: `${env.API_PREFIX}/withdrawals` });
  await app.register(preApprovalRoutes, { prefix: env.API_PREFIX });
  await app.register(balanceRoutes, { prefix: env.API_PREFIX });
  await app.register(consentRoutes, { prefix: env.API_PREFIX });
  await app.register(webhookRoutes, { prefix: env.API_PREFIX });

  // Admin routes with separate prefix
  await app.register(adminRoutes, { prefix: `${env.API_PREFIX}/admin` });

  // 404 handler for API routes
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith(env.API_PREFIX)) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`,
      });
    } else {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Resource not found',
      });
    }
  });
}

// Export all route modules
export { healthRoutes } from './health.routes.ts';
export { paymentRoutes } from './payment.routes.ts';
export { transferRoutes } from './transfer.routes.ts';
export { preApprovalRoutes } from './preapproval.routes.ts';
export { balanceRoutes } from './balance.routes.ts';
export { consentRoutes } from './consent.routes.ts';
export { authRoutes } from './auth.routes.ts';
export { webhookRoutes } from './webhook.routes.ts';
