import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app } from '../../src/app.ts';
import { prisma } from '../../src/utils/database.ts';

describe('Transfer Integration Tests', () => {
  let testApiKeyId: string;
  let testUserId: string;
  let testApiKey: string;

  beforeAll(async () => {
    // Setup test user and API key
    const testUser = await prisma.user.create({
      data: {
        email: 'transfers@test.com',
        username: 'transferuser',
        passwordHash: 'hashedpassword',
        businessName: 'Transfer Test Business',
      },
    });
    testUserId = testUser.id;

    const apiKey = await prisma.apiKey.create({
      data: {
        key: 'test_transfer_key_' + Date.now(),
        name: 'Transfer Test Key',
        userId: testUserId,
        isActive: true,
      },
    });
    testApiKeyId = apiKey.id;
    testApiKey = apiKey.key;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.transfer.deleteMany({ where: { apiKeyId: testApiKeyId } });
    await prisma.apiKey.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  beforeEach(async () => {
    // Clean up transfers before each test
    await prisma.transfer.deleteMany({ where: { apiKeyId: testApiKeyId } });
  });

  describe('POST /api/v1/transfers', () => {
    it('should create a new transfer successfully', async () => {
      const transferData = {
        transferId: `test_transfer_${Date.now()}`,
        from: '237670000000',
        to: '237680000000',
        amount: 10000,
        currency: 'XAF',
        description: 'Test transfer',
        provider: 'MTN',
        metadata: {
          purpose: 'test',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/transfers',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: transferData,
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.transferId).toBe(transferData.transferId);
      expect(result.data.amount).toBe(transferData.amount);
      expect(result.data.from).toBe(transferData.from);
      expect(result.data.to).toBe(transferData.to);
      expect(result.data.status).toBeDefined();
    });

    it('should fail with missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/transfers',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          from: '237670000000',
          // Missing 'to' and 'amount'
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should fail with invalid amount', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/transfers',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          transferId: `test_transfer_${Date.now()}`,
          from: '237670000000',
          to: '237680000000',
          amount: -500, // Invalid negative amount
          currency: 'XAF',
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('greater than 0');
    });

    it('should fail without API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/transfers',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          transferId: `test_transfer_${Date.now()}`,
          from: '237670000000',
          to: '237680000000',
          amount: 1000,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should generate transferId if not provided', async () => {
      const transferData = {
        from: '237670000000',
        to: '237680000000',
        amount: 5000,
        currency: 'XAF',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/transfers',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: transferData,
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.transferId).toBeDefined();
      expect(result.data.transferId).toMatch(/^ft_/);
    });
  });

  describe('GET /api/v1/transfers/:transferId', () => {
    let testTransferId: string;

    beforeEach(async () => {
      // Create a test transfer
      const transfer = await prisma.transfer.create({
        data: {
          transferId: `test_get_${Date.now()}`,
          from: '237670000000',
          to: '237680000000',
          amount: 7500,
          currency: 'XAF',
          status: 'COMPLETED',
          provider: 'MTN',
          apiKeyId: testApiKeyId,
          userId: testUserId,
        },
      });
      testTransferId = transfer.transferId;
    });

    it('should get transfer details successfully', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/transfers/${testTransferId}`,
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.transferId).toBe(testTransferId);
      expect(result.data.amount).toBe(7500);
      expect(result.data.status).toBe('COMPLETED');
    });

    it('should fail for non-existent transfer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/transfers/non_existent_id',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Transfer not found');
    });

    it('should fail without API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/transfers/${testTransferId}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/transfers/:transferId/status', () => {
    let testTransferId: string;

    beforeEach(async () => {
      // Create a test transfer with provider reference
      const transfer = await prisma.transfer.create({
        data: {
          transferId: `test_status_${Date.now()}`,
          from: '237670000000',
          to: '237680000000',
          amount: 3000,
          currency: 'XAF',
          status: 'PENDING',
          provider: 'MTN',
          providerReference: 'mtn_ref_123',
          apiKeyId: testApiKeyId,
          userId: testUserId,
        },
      });
      testTransferId = transfer.transferId;
    });

    it('should get transfer status successfully', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/transfers/${testTransferId}/status`,
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.transferId).toBeDefined();
      expect(result.data.status).toBeDefined();
    });

    it('should fail for transfer without provider reference', async () => {
      // Create a transfer without provider reference
      const transfer = await prisma.transfer.create({
        data: {
          transferId: `test_no_ref_${Date.now()}`,
          from: '237670000000',
          to: '237680000000',
          amount: 2000,
          currency: 'XAF',
          status: 'PENDING',
          provider: 'MTN',
          apiKeyId: testApiKeyId,
          userId: testUserId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/transfers/${transfer.transferId}/status`,
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not yet processed');
    });
  });

  describe('GET /api/v1/transfers', () => {
    beforeEach(async () => {
      // Create test transfers
      await prisma.transfer.createMany({
        data: [
          {
            transferId: `list_test_1_${Date.now()}`,
            from: '237670000000',
            to: '237680000000',
            amount: 1000,
            currency: 'XAF',
            status: 'COMPLETED',
            provider: 'MTN',
            apiKeyId: testApiKeyId,
            userId: testUserId,
          },
          {
            transferId: `list_test_2_${Date.now()}`,
            from: '237670000000',
            to: '237680000000',
            amount: 2000,
            currency: 'XAF',
            status: 'PENDING',
            provider: 'MTN',
            apiKeyId: testApiKeyId,
            userId: testUserId,
          },
          {
            transferId: `list_test_3_${Date.now()}`,
            from: '237670000000',
            to: '237680000000',
            amount: 3000,
            currency: 'XAF',
            status: 'FAILED',
            provider: 'MTN',
            apiKeyId: testApiKeyId,
            userId: testUserId,
          },
        ],
      });
    });

    it('should list transfers with pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/transfers?page=1&limit=2',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.transfers).toHaveLength(2);
      expect(result.data.pagination.page).toBe(1);
      expect(result.data.pagination.limit).toBe(2);
      expect(result.data.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('should filter transfers by status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/transfers?status=COMPLETED',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.transfers.every((t: any) => t.status === 'COMPLETED')).toBe(true);
    });

    it('should fail with invalid pagination parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/transfers?page=0&limit=200',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid page or limit parameters');
    });
  });

  describe('GET /api/v1/account/balance', () => {
    it('should get account balance successfully', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/account/balance?provider=MTN',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.balances).toBeDefined();
      expect(Array.isArray(result.data.balances)).toBe(true);
      expect(result.data.timestamp).toBeDefined();
    });

    it('should default to MTN provider', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/account/balance',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
    });
  });

  describe('POST /api/v1/account/validate', () => {
    it('should validate recipient successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/account/validate',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          accountId: '237680000000',
          provider: 'MTN',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.accountId).toBe('237680000000');
      expect(typeof result.data.isActive).toBe('boolean');
    });

    it('should fail without accountId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/account/validate',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          provider: 'MTN',
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toBe('accountId is required');
    });
  });

  describe('POST /api/v1/account/userinfo', () => {
    it('should get user info successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/account/userinfo',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          accountId: '237680000000',
          provider: 'MTN',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.accountId).toBe('237680000000');
    });

    it('should fail without accountId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/account/userinfo',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          provider: 'MTN',
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toBe('accountId is required');
    });
  });

  describe('POST /api/v1/deposits', () => {
    it('should create a deposit successfully', async () => {
      const depositData = {
        depositId: `test_deposit_${Date.now()}`,
        accountId: '237680000000',
        amount: 5000,
        currency: 'XAF',
        description: 'Test deposit',
        provider: 'MTN',
        metadata: {
          source: 'test',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/deposits',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: depositData,
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.depositId).toBe(depositData.depositId);
      expect(result.data.amount).toBe(depositData.amount);
      expect(result.data.accountId).toBe(depositData.accountId);
      expect(result.data.status).toBeDefined();
    });

    it('should fail with missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/deposits',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          accountId: '237680000000',
          // Missing amount
        },
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should generate depositId if not provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/deposits',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': testApiKey,
        },
        payload: {
          accountId: '237680000000',
          amount: 3000,
          currency: 'XAF',
        },
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.data.depositId).toBeDefined();
      expect(result.data.depositId).toMatch(/^dp_/);
    });
  });
});