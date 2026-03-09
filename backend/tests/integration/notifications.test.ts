import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { app } from '../../src/app.ts';
import { prisma } from '../../src/utils/database.ts';
import { generateApiKey } from '../../src/utils/auth.ts';

describe('Notification API Integration Tests', () => {
  let server: FastifyInstance;
  let apiKey: string;
  let userId: string;
  let paymentId: string;

  beforeAll(async () => {
    server = app;
    await server.ready();

    // Create test user
    const user = await prisma.user.create({
      data: {
        email: 'notification-test@example.com',
        username: 'notification-test',
        passwordHash: 'test-hash',
        businessName: 'Notification Test Business',
        phoneNumber: '237670000000',
      },
    });
    userId = user.id;

    // Create API key
    const key = generateApiKey();
    apiKey = `fp_test_${key}`;
    await prisma.apiKey.create({
      data: {
        key: apiKey,
        name: 'Notification Test Key',
        userId,
      },
    });

    // Create a completed payment with provider reference
    const payment = await prisma.payment.create({
      data: {
        transactionId: `notification_test_${Date.now()}`,
        amount: 100,
        from: '237670000000',
        to: '237680000000',
        currency: 'XAF',
        provider: 'MTN',
        status: 'COMPLETED',
        providerReference: 'mtn_ref_123456',
        timestamp: new Date(),
        apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.paymentNotification.deleteMany({ where: { paymentId } });
    await prisma.payment.deleteMany({ where: { id: paymentId } });
    await prisma.apiKey.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await server.close();
  });

  describe('POST /payments/:id/notify', () => {
    it('should send a notification for a payment', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/notify`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          message: 'Your payment has been processed successfully!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe('Notification sent successfully');
      expect(body.paymentId).toBe(paymentId);

      // Verify notification was stored
      const notification = await prisma.paymentNotification.findFirst({
        where: { paymentId },
      });
      expect(notification).toBeDefined();
      expect(notification?.message).toBe('Your payment has been processed successfully!');
    });

    it('should truncate message to 160 characters', async () => {
      const longMessage = 'A'.repeat(200);
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/notify`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          message: longMessage,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify stored message is truncated
      const notification = await prisma.paymentNotification.findFirst({
        where: {
          paymentId,
          message: 'A'.repeat(160),
        },
      });
      expect(notification).toBeDefined();
      expect(notification?.message.length).toBe(160);
    });

    it('should reject notification for payment without provider reference', async () => {
      // Create payment without provider reference
      const payment = await prisma.payment.create({
        data: {
          transactionId: `no_ref_test_${Date.now()}`,
          amount: 50,
          from: '237670000000',
          to: '237680000000',
          currency: 'XAF',
          provider: 'MTN',
          status: 'PENDING',
          timestamp: new Date(),
          apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${payment.id}/notify`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          message: 'Test notification',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('provider reference');

      // Cleanup
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('should return 404 for non-existent payment', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/payments/non_existent_payment/notify',
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          message: 'Test notification',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Payment not found');
    });

    it('should reject notification without message', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/notify`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should work with payment transactionId as well as id', async () => {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${payment!.transactionId}/notify`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          message: 'Notification via transaction ID',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.paymentId).toBe(paymentId);
    });
  });

  describe('Notification Storage', () => {
    it('should track multiple notifications for same payment', async () => {
      // Send multiple notifications
      for (let i = 1; i <= 3; i++) {
        await server.inject({
          method: 'POST',
          url: `/api/v1/payments/${paymentId}/notify`,
          headers: {
            'x-api-key': apiKey,
          },
          payload: {
            message: `Notification ${i}`,
          },
        });
      }

      // Check all notifications are stored
      const notifications = await prisma.paymentNotification.findMany({
        where: { paymentId },
        orderBy: { createdAt: 'asc' },
      });

      expect(notifications.length).toBeGreaterThanOrEqual(3);
      const messages = notifications.map((n: any) => n.message);
      expect(messages).toContain('Notification 1');
      expect(messages).toContain('Notification 2');
      expect(messages).toContain('Notification 3');
    });

    it('should store provider response in notification record', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/notify`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          message: 'Test with response tracking',
        },
      });

      expect(response.statusCode).toBe(200);

      const notification = await prisma.paymentNotification.findFirst({
        where: {
          paymentId,
          message: 'Test with response tracking',
        },
      });

      expect(notification).toBeDefined();
      expect(notification?.provider).toBe('MTN');
      expect(notification?.response).toBeDefined();
    });
  });
});
