import { FastifyRequest, FastifyReply } from 'fastify';
import { WebhookService } from '../services/webhook.service.ts';
import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';

interface ConfigureWebhookBody {
  url: string;
  events?: string[];
  secret?: string;
}

interface TestWebhookBody {
  url: string;
}

export class WebhookController {
  /**
   * Configure webhook for user
   */
  async configure(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { url, events, secret } = request.body as ConfigureWebhookBody;
      const apiKeyId = request.apiKey?.id;

      if (!apiKeyId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key required',
        });
      }

      // Get user from API key
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
        select: { userId: true },
      });

      if (!apiKey) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
      }

      // Update user settings with webhook configuration
      const settings = await prisma.userSettings.upsert({
        where: { userId: apiKey.userId },
        update: {
          webhookUrl: url,
          webhookSecret: secret || crypto.randomBytes(32).toString('hex'),
          webhookEvents: events || ['payment.created', 'payment.completed', 'payment.failed'],
        },
        create: {
          userId: apiKey.userId,
          webhookUrl: url,
          webhookSecret: secret || crypto.randomBytes(32).toString('hex'),
          webhookEvents: events || ['payment.created', 'payment.completed', 'payment.failed'],
          notificationEmail: '',
          enableEmail: true,
          enableSMS: false,
          timezone: 'Africa/Douala',
        },
      });

      logger.info({ userId: apiKey.userId, url }, 'Webhook configured');

      return {
        message: 'Webhook configured successfully',
        url: settings.webhookUrl,
        events: settings.webhookEvents,
      };
    } catch (error) {
      logger.error({ error }, 'Error configuring webhook');
      throw error;
    }
  }

  /**
   * Get webhook configuration
   */
  async getConfiguration(request: FastifyRequest, reply: FastifyReply) {
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Get user from API key
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { userId: true },
    });

    if (!apiKey) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId: apiKey.userId },
      select: {
        webhookUrl: true,
        webhookEvents: true,
      },
    });

    if (!settings?.webhookUrl) {
      return {
        configured: false,
        message: 'No webhook configured',
      };
    }

    return {
      configured: true,
      url: settings.webhookUrl,
      events: settings.webhookEvents,
    };
  }

  /**
   * Get webhook delivery history
   */
  async getDeliveryHistory(request: FastifyRequest, reply: FastifyReply) {
    const { paymentId } = request.params as { paymentId: string };
    const apiKeyId = request.apiKey?.id;
    const query = request.query as { limit?: string; offset?: string };

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Verify payment belongs to this API key
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        apiKeyId,
      },
    });

    if (!payment) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    const limit = parseInt(query.limit || '100', 10);
    const offset = parseInt(query.offset || '0', 10);

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return deliveries.map(delivery => ({
      id: delivery.id,
      url: delivery.url,
      status: delivery.status,
      attempts: delivery.attempts,
      response: delivery.response,
      lastAttemptAt: delivery.lastAttempt?.toISOString(),
      createdAt: delivery.createdAt.toISOString(),
    }));
  }

  /**
   * Retry failed webhooks
   */
  async retryFailed(request: FastifyRequest, reply: FastifyReply) {
    const apiKeyId = request.apiKey?.id;

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Get failed webhooks for this API key's payments
    const failedDeliveries = await prisma.webhookDelivery.findMany({
      where: {
        status: 'FAILED',
        payment: {
          apiKeyId,
        },
        attempts: { lt: 5 },
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    // Queue them for retry
    for (const delivery of failedDeliveries) {
      await WebhookService.processWebhook(delivery.id);
    }

    logger.info({ count: failedDeliveries.length, apiKeyId }, 'Retrying failed webhooks');

    return {
      message: `Queued ${failedDeliveries.length} webhooks for retry`,
      count: failedDeliveries.length,
    };
  }

  /**
   * Test webhook endpoint
   */
  async test(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { url } = request.body as TestWebhookBody;
      const apiKeyId = request.apiKey?.id;

      if (!apiKeyId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key required',
        });
      }

      // Create test payload
      const testPayload = {
        event: 'payment.test',
        transactionId: `test_${Date.now()}`,
        status: 'COMPLETED',
        amount: 1000,
        from: '237670000000',
        to: '237680000000',
        timestamp: new Date().toISOString(),
        metadata: { test: true },
      };

      // Create temporary webhook delivery
      const delivery = await prisma.webhookDelivery.create({
        data: {
          paymentId: `test_${Date.now()}`,
          url,
          payload: testPayload as any,
          status: 'PENDING',
          attempts: 0,
        },
      });

      // Process webhook
      await WebhookService.processWebhook(delivery.id);

      // Check result
      const result = await prisma.webhookDelivery.findUnique({
        where: { id: delivery.id },
      });

      // Clean up test delivery
      await prisma.webhookDelivery.delete({
        where: { id: delivery.id },
      });

      const success = result?.status === 'DELIVERED';

      logger.info({ url, success }, 'Webhook test completed');

      return {
        success,
        message: success
          ? 'Webhook test successful'
          : `Webhook test failed: ${result?.lastError || 'Unknown error'}`,
        response: result?.response,
        statusCode: success ? 200 : null,
      };
    } catch (error) {
      logger.error({ error }, 'Error testing webhook');
      throw error;
    }
  }

  /**
   * Get webhook statistics
   */
  async getStats(request: FastifyRequest, reply: FastifyReply) {
    const apiKeyId = request.apiKey?.id;
    const query = request.query as { startDate?: string; endDate?: string };

    if (!apiKeyId) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    const where: any = {
      payment: { apiKeyId },
    };

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [total, delivered, failed, pending] = await Promise.all([
      prisma.webhookDelivery.count({ where }),
      prisma.webhookDelivery.count({ where: { ...where, status: 'DELIVERED' } }),
      prisma.webhookDelivery.count({ where: { ...where, status: 'FAILED' } }),
      prisma.webhookDelivery.count({ where: { ...where, status: 'PENDING' } }),
    ]);

    // Get average delivery time
    const deliveredWebhooks = await prisma.webhookDelivery.findMany({
      where: {
        ...where,
        status: 'DELIVERED',
        deliveredAt: { not: null },
      },
      select: {
        createdAt: true,
        deliveredAt: true,
      },
    });

    const deliveryTimes = deliveredWebhooks
      .filter(w => w.deliveredAt)
      .map(w => w.deliveredAt!.getTime() - w.createdAt.getTime());

    const avgDeliveryTime = deliveryTimes.length > 0
      ? deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length
      : 0;

    return {
      total,
      byStatus: {
        delivered,
        failed,
        pending,
      },
      deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
      averageDeliveryTime: Math.round(avgDeliveryTime / 1000), // in seconds
    };
  }
}

// Add missing import
import crypto from 'crypto';
