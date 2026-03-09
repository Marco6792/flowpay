import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { app } from '../../src/app.ts';
import { prisma } from '../../src/utils/database.ts';
import { generateApiKey } from '../../src/utils/auth.ts';
import { WebhookService } from '../../src/services/webhook.service.ts';
import crypto from 'crypto';

describe('Webhook Integration Tests', () => {
  let server: FastifyInstance;
  let apiKey: string;
  let userId: string;
  let paymentId: string;

  beforeAll(async () => {
    server = app;
    await server.ready();

    // Create test user with webhook URL
    const user = await prisma.user.create({
      data: {
        email: 'webhook-test@example.com',
        username: 'webhook-test',
        passwordHash: 'test-hash',
        businessName: 'Webhook Test Business',
        phoneNumber: '237670000000',
        settings: {
          create: {
            webhookUrl: 'https://webhook.site/test-webhook',
            webhookSecret: 'test_webhook_secret',
          },
        },
      },
    });
    userId = user.id;

    // Create API key
    const key = generateApiKey();
    apiKey = `fp_test_${key}`;
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        key: apiKey,
        name: 'Webhook Test Key',
        userId,
      },
    });

    // Create a test payment
    const payment = await prisma.payment.create({
      data: {
        transactionId: `webhook_test_${Date.now()}`,
        amount: 100,
        from: '237670000000',
        to: '237680000000',
        currency: 'XAF',
        provider: 'MTN',
        status: 'PENDING',
        providerReference: 'mtn_webhook_ref_123',
        timestamp: new Date(),
        apiKeyId: apiKeyRecord.id,
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.webhookDelivery.deleteMany({ where: { paymentId } });
    await prisma.payment.deleteMany({ where: { id: paymentId } });
    await prisma.apiKey.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await server.close();
  });

  describe('MTN Webhook Receiver', () => {
    it('should receive and process MTN webhook for payment update', async () => {
      const mtnPayload = {
        financialTransactionId: 'mtn_fin_123456',
        externalId: (await prisma.payment.findUnique({ where: { id: paymentId } }))!.transactionId,
        amount: '100',
        currency: 'XAF',
        payer: {
          partyIdType: 'MSISDN',
          partyId: '237670000000',
        },
        status: 'SUCCESSFUL',
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mtn',
        headers: {
          'x-reference-id': 'mtn_webhook_ref_123',
        },
        payload: mtnPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
      expect(body.status).toBe('processed');

      // Verify payment was updated
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });
      expect(updatedPayment?.status).toBe('COMPLETED');

      // Verify webhook was stored
      const webhookDelivery = await prisma.webhookDelivery.findFirst({
        where: {
          paymentId,
          provider: 'MTN',
        },
      });
      expect(webhookDelivery).toBeDefined();
      expect(webhookDelivery?.status).toBe('DELIVERED');
    });

    it('should handle failed payment webhook', async () => {
      // Create another payment for failure test
      const payment = await prisma.payment.create({
        data: {
          transactionId: `webhook_fail_test_${Date.now()}`,
          amount: 50,
          from: '237670000000',
          to: '237680000000',
          currency: 'XAF',
          provider: 'MTN',
          status: 'PENDING',
          providerReference: 'mtn_fail_ref_456',
          timestamp: new Date(),
          apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
        },
      });

      const mtnPayload = {
        externalId: payment.transactionId,
        amount: '50',
        currency: 'XAF',
        status: 'FAILED',
        reason: 'Insufficient funds',
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mtn',
        headers: {
          'x-reference-id': 'mtn_fail_ref_456',
        },
        payload: mtnPayload,
      });

      expect(response.statusCode).toBe(200);

      // Verify payment was marked as failed
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      expect(updatedPayment?.status).toBe('FAILED');

      // Cleanup
      await prisma.webhookDelivery.deleteMany({ where: { paymentId: payment.id } });
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('should return 404 for webhook with unknown payment', async () => {
      const mtnPayload = {
        externalId: 'unknown_payment_id',
        amount: '100',
        currency: 'XAF',
        status: 'SUCCESSFUL',
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mtn',
        headers: {
          'x-reference-id': 'unknown_ref',
        },
        payload: mtnPayload,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Payment not found');
    });

    it('should validate webhook payload structure', async () => {
      const invalidPayload = {
        // Missing required fields
        amount: '100',
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mtn',
        payload: invalidPayload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid payload');
    });
  });

  describe('Test Webhook Endpoint', () => {
    it('should allow testing webhooks in development', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/test',
        payload: {
          paymentId: (await prisma.payment.findUnique({ where: { id: paymentId } }))!.transactionId,
          status: 'SUCCESSFUL',
          provider: 'mtn',
        },
      });

      // In test/development mode, this should work
      if (process.env.NODE_ENV !== 'production') {
        expect(response.statusCode).toBe(200);
      }
    });

    it('should be disabled in production', async () => {
      // Temporarily set NODE_ENV to production
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/test',
        payload: {
          paymentId: 'test_payment',
          status: 'SUCCESSFUL',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Test endpoint disabled in production');

      // Restore original NODE_ENV
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Webhook Forwarding', () => {
    it('should queue webhook for client delivery when payment status changes', async () => {
      // Spy on WebhookService.queueWebhook
      const queueSpy = vi.spyOn(WebhookService, 'queueWebhook');

      // Create a payment with webhook-enabled user
      const apiKeyRecord = await prisma.apiKey.findFirst({ where: { key: apiKey } });
      const payment = await prisma.payment.create({
        data: {
          transactionId: `forward_test_${Date.now()}`,
          amount: 75,
          from: '237670000000',
          to: '237680000000',
          currency: 'XAF',
          provider: 'MTN',
          status: 'PENDING',
          providerReference: 'mtn_forward_ref',
          timestamp: new Date(),
          apiKeyId: apiKeyRecord!.id,
        },
      });

      // Send MTN webhook to update payment
      const mtnPayload = {
        externalId: payment.transactionId,
        amount: '75',
        currency: 'XAF',
        status: 'SUCCESSFUL',
      };

      await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mtn',
        headers: {
          'x-reference-id': 'mtn_forward_ref',
        },
        payload: mtnPayload,
      });

      // Verify webhook was queued
      expect(queueSpy).toHaveBeenCalledWith(
        payment.id,
        'payment.completed',
        'https://webhook.site/test-webhook'
      );

      // Cleanup
      queueSpy.mockRestore();
      await prisma.webhookDelivery.deleteMany({ where: { paymentId: payment.id } });
      await prisma.payment.delete({ where: { id: payment.id } });
    });
  });

  describe('Webhook Signature Verification', () => {
    it('should generate correct webhook signatures', () => {
      const payload = {
        event: 'payment.completed',
        transactionId: 'test_123',
        status: 'COMPLETED',
        amount: 100,
        from: '237670000000',
        to: '237680000000',
        timestamp: new Date().toISOString(),
      };

      const secret = process.env.WEBHOOK_SECRET || 'default_webhook_secret';
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      const isValid = WebhookService.verifyWebhookSignature(payload, expectedSignature);
      expect(isValid).toBe(true);
    });

    it('should reject invalid webhook signatures', () => {
      const payload = {
        event: 'payment.completed',
        transactionId: 'test_123',
      };

      const invalidSignature = 'invalid_signature_12345';
      const isValid = WebhookService.verifyWebhookSignature(payload, invalidSignature);
      expect(isValid).toBe(false);
    });
  });

  describe('Provider-specific Webhook Routing', () => {
    it('should route to MTN handler via generic endpoint', async () => {
      const mtnPayload = {
        externalId: (await prisma.payment.findUnique({ where: { id: paymentId } }))!.transactionId,
        amount: '100',
        currency: 'XAF',
        status: 'SUCCESSFUL',
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/provider/mtn',
        headers: {
          'x-reference-id': 'mtn_webhook_ref_123',
        },
        payload: mtnPayload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should route to Orange handler via generic endpoint', async () => {
      const orangePayload = {
        // Orange-specific payload structure
        transactionId: 'orange_123',
        status: 'SUCCESS',
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/webhooks/provider/orange',
        payload: orangePayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
    });
  });
});
