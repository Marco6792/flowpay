import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { app } from '../../src/app.ts';
import { prisma } from '../../src/utils/database.ts';
import { generateApiKey } from '../../src/utils/auth.ts';

describe('Refund API Integration Tests', () => {
  let server: FastifyInstance;
  let apiKey: string;
  let userId: string;
  let paymentId: string;
  let refundId: string;

  beforeAll(async () => {
    server = app;
    await server.ready();

    // Create test user
    const user = await prisma.user.create({
      data: {
        email: 'refund-test@example.com',
        username: 'refund-test',
        passwordHash: 'test-hash',
        businessName: 'Refund Test Business',
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
        name: 'Refund Test Key',
        userId,
      },
    });

    // Create a completed payment for testing refunds
    const payment = await prisma.payment.create({
      data: {
        transactionId: `refund_test_${Date.now()}`,
        amount: 100,
        from: '237670000000',
        to: '237680000000',
        currency: 'XAF',
        provider: 'MTN',
        status: 'COMPLETED',
        providerReference: 'test_ref_123',
        timestamp: new Date(),
        apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.refund.deleteMany({ where: { paymentId } });
    await prisma.payment.deleteMany({ where: { id: paymentId } });
    await prisma.apiKey.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await server.close();
  });

  describe('POST /payments/:id/refund', () => {
    it('should create a full refund for a completed payment', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/refund`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          reason: 'Customer request',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.amount).toBe(100);
      expect(body.refundId).toBeDefined();
      refundId = body.refundId;
    });

    it('should create a partial refund with specified amount', async () => {
      // Create another payment for partial refund
      const payment = await prisma.payment.create({
        data: {
          transactionId: `partial_refund_test_${Date.now()}`,
          amount: 200,
          from: '237670000000',
          to: '237680000000',
          currency: 'XAF',
          provider: 'MTN',
          status: 'COMPLETED',
          providerReference: 'test_ref_456',
          timestamp: new Date(),
          apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${payment.id}/refund`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          amount: 50,
          reason: 'Partial refund',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.amount).toBe(50);

      // Cleanup
      await prisma.refund.deleteMany({ where: { paymentId: payment.id } });
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('should reject refund for non-completed payment', async () => {
      // Create a pending payment
      const payment = await prisma.payment.create({
        data: {
          transactionId: `pending_refund_test_${Date.now()}`,
          amount: 100,
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
        url: `/api/v1/payments/${payment.id}/refund`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          reason: 'Invalid refund',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toContain('Only completed payments can be refunded');

      // Cleanup
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('should reject refund amount exceeding payment amount', async () => {
      // Create a payment
      const payment = await prisma.payment.create({
        data: {
          transactionId: `excess_refund_test_${Date.now()}`,
          amount: 100,
          from: '237670000000',
          to: '237680000000',
          currency: 'XAF',
          provider: 'MTN',
          status: 'COMPLETED',
          providerReference: 'test_ref_789',
          timestamp: new Date(),
          apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${payment.id}/refund`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          amount: 150,
          reason: 'Excess refund',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Refund amount cannot exceed payment amount');

      // Cleanup
      await prisma.payment.delete({ where: { id: payment.id } });
    });
  });

  describe('GET /refunds/:refundId/status', () => {
    it('should get refund status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/refunds/${refundId}/status`,
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(refundId);
      expect(body.paymentId).toBe(paymentId);
      expect(body.amount).toBe(100);
      expect(body.status).toBeDefined();
    });

    it('should return 404 for non-existent refund', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/refunds/non_existent_refund/status',
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Not Found');
    });
  });

  describe('GET /payments/:id/refunds', () => {
    it('should list all refunds for a payment', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/payments/${paymentId}/refunds`,
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.paymentId).toBe(paymentId);
      expect(Array.isArray(body.refunds)).toBe(true);
      expect(body.refunds.length).toBeGreaterThan(0);
      expect(body.refunds[0].id).toBe(refundId);
    });

    it('should return empty array for payment with no refunds', async () => {
      // Create a payment without refunds
      const payment = await prisma.payment.create({
        data: {
          transactionId: `no_refund_test_${Date.now()}`,
          amount: 100,
          from: '237670000000',
          to: '237680000000',
          currency: 'XAF',
          provider: 'MTN',
          status: 'COMPLETED',
          timestamp: new Date(),
          apiKeyId: (await prisma.apiKey.findFirst({ where: { key: apiKey } }))!.id,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/payments/${payment.id}/refunds`,
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.paymentId).toBe(payment.id);
      expect(body.refunds).toEqual([]);

      // Cleanup
      await prisma.payment.delete({ where: { id: payment.id } });
    });
  });
});
