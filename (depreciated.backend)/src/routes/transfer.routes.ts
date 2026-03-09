import { FastifyInstance } from 'fastify';
import { transferController } from '../controllers/transfer.controller.ts';

export async function transferRoutes(app: FastifyInstance) {
  // Transfer endpoints
  app.post('/transfers', {
    schema: {
      body: {
        type: 'object',
        required: ['from', 'to', 'amount'],
        properties: {
          transferId: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          amount: { type: 'number', minimum: 0.01 },
          currency: { type: 'string', default: 'XAF' },
          description: { type: 'string' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
          metadata: { type: 'object' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                transferId: { type: 'string' },
                status: { type: 'string' },
                amount: { type: 'number' },
                currency: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                description: { type: 'string' },
                fee: { type: 'number' },
                providerReference: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, transferController.createTransfer.bind(transferController));

  app.get('/transfers/:transferId', {
    schema: {
      params: {
        type: 'object',
        required: ['transferId'],
        properties: {
          transferId: { type: 'string' },
        },
      },
    },
  }, transferController.getTransfer.bind(transferController));

  app.get('/transfers/:transferId/status', {
    schema: {
      params: {
        type: 'object',
        required: ['transferId'],
        properties: {
          transferId: { type: 'string' },
        },
      },
    },
  }, transferController.getTransferStatus.bind(transferController));

  app.get('/transfers', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', pattern: '^[1-9][0-9]*$' },
          limit: { type: 'string', pattern: '^[1-9][0-9]*$' },
          status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'] },
        },
      },
    },
  }, transferController.listTransfers.bind(transferController));

  // Account management endpoints
  app.get('/account/balance', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
    },
  }, transferController.getBalance.bind(transferController));

  app.post('/account/validate', {
    schema: {
      body: {
        type: 'object',
        required: ['accountId'],
        properties: {
          accountId: { type: 'string' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
    },
  }, transferController.validateRecipient.bind(transferController));

  app.post('/account/userinfo', {
    schema: {
      body: {
        type: 'object',
        required: ['accountId'],
        properties: {
          accountId: { type: 'string' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
    },
  }, transferController.getUserInfo.bind(transferController));

  // Deposit endpoint
  app.post('/deposits', {
    schema: {
      body: {
        type: 'object',
        required: ['accountId', 'amount'],
        properties: {
          depositId: { type: 'string' },
          accountId: { type: 'string' },
          amount: { type: 'number', minimum: 0.01 },
          currency: { type: 'string', default: 'XAF' },
          description: { type: 'string' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
          metadata: { type: 'object' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                depositId: { type: 'string' },
                status: { type: 'string' },
                amount: { type: 'number' },
                currency: { type: 'string' },
                accountId: { type: 'string' },
                description: { type: 'string' },
                fee: { type: 'number' },
                providerDepositId: { type: 'string' },
                timestamp: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, transferController.createDeposit.bind(transferController));

  // Get deposit status
  app.get('/deposits/:depositId/status', {
    schema: {
      params: {
        type: 'object',
        required: ['depositId'],
        properties: {
          depositId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                depositId: { type: 'string' },
                providerDepositId: { type: 'string' },
                status: { type: 'string' },
                amount: { type: 'number' },
                currency: { type: 'string' },
                accountId: { type: 'string' },
                fee: { type: ['number', 'null'] },
                completedAt: { type: ['string', 'null'] },
                failureReason: { type: ['string', 'null'] },
                financialTransactionId: { type: ['string', 'null'] },
                lastUpdated: { type: 'string' },
                cached: { type: 'boolean' },
              },
            },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: false },
            error: { type: 'string' },
          },
        },
      },
    },
  }, transferController.getDepositStatus.bind(transferController));
}