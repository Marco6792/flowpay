import { FastifyInstance } from 'fastify';
import { preApprovalService } from '../services/preapproval.service.ts';
import { logger } from '../utils/logger.ts';

export async function preApprovalRoutes(fastify: FastifyInstance) {
  // Create PreApproval
  fastify.post('/preapprovals', {
    schema: {
      body: {
        type: 'object',
        required: ['payerPhone', 'validityTime'],
        properties: {
          preApprovalId: { type: 'string' },
          payerPhone: { type: 'string' },
          payerCurrency: { type: 'string' },
          payerMessage: { type: 'string' },
          validityTime: { type: 'number', minimum: 60, maximum: 86400 }, // 1 minute to 24 hours
          provider: { type: 'string', enum: ['MTN', 'ORANGE'] },
          metadata: { type: 'object' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            preApproval: {
              type: 'object',
              properties: {
                preApprovalId: { type: 'string' },
                referenceId: { type: 'string' },
                status: { type: 'string' },
                providerReference: { type: 'string' },
                payerPhone: { type: 'string' },
                payerCurrency: { type: 'string' },
                payerMessage: { type: 'string' },
                validityTime: { type: 'number' },
                expiresAt: { type: 'string' },
                createdAt: { type: 'string' },
                rawCreateRequest: { type: 'object', nullable: true },
                rawCreateResponse: { type: 'object', nullable: true },
              },
            },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;
      
      if (!apiKeyId || !userId) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication required - missing API key or user context',
        });
      }

      const result = await preApprovalService.createPreApproval(
        apiKeyId,
        userId,
        request.body as any
      );

      if (!result.success) {
        return reply.code(400).send(result);
      }

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create PreApproval');
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  // Get PreApproval status
  fastify.get('/preapprovals/:preApprovalId/status', {
    schema: {
      params: {
        type: 'object',
        required: ['preApprovalId'],
        properties: {
          preApprovalId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            preApprovalId: { type: 'string' },
            referenceId: { type: 'string' },
            providerReference: { type: 'string' },
            status: { type: 'string' },
            payerPhone: { type: 'string' },
            expiresAt: { type: 'string' },
            approvedAt: { type: 'string', nullable: true },
            rejectedAt: { type: 'string', nullable: true },
            expiredAt: { type: 'string', nullable: true },
            failureReason: { type: 'string', nullable: true },
            rawStatusResponse: { type: 'object', nullable: true },
            lastUpdated: { type: 'string' },
            cached: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const { preApprovalId } = request.params as any;
      
      if (!apiKeyId) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication required - missing API key context',
        });
      }

      const result = await preApprovalService.getPreApprovalStatus(preApprovalId, apiKeyId);

      if (!result.success) {
        return reply.code(404).send(result);
      }

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get PreApproval status');
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  // Cancel PreApproval
  fastify.post('/preapprovals/:preApprovalId/cancel', {
    schema: {
      params: {
        type: 'object',
        required: ['preApprovalId'],
        properties: {
          preApprovalId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            preApprovalId: { type: 'string' },
            status: { type: 'string' },
            rawCancelResponse: { type: 'object', nullable: true },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const { preApprovalId } = request.params as any;
      
      if (!apiKeyId) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication required - missing API key context',
        });
      }

      const result = await preApprovalService.cancelPreApproval(preApprovalId, apiKeyId);

      if (!result.success) {
        return reply.code(400).send(result);
      }

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to cancel PreApproval');
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  // Get PreApproval details
  fastify.get('/preapprovals/:preApprovalId', {
    schema: {
      params: {
        type: 'object',
        required: ['preApprovalId'],
        properties: {
          preApprovalId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            preApproval: {
              type: 'object',
              properties: {
                preApprovalId: { type: 'string' },
                referenceId: { type: 'string' },
                status: { type: 'string' },
                providerReference: { type: 'string' },
                payerPhone: { type: 'string' },
                payerCurrency: { type: 'string' },
                payerMessage: { type: 'string' },
                validityTime: { type: 'number' },
                expiresAt: { type: 'string' },
                provider: { type: 'string' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
                approvedAt: { type: 'string', nullable: true },
                cancelledAt: { type: 'string', nullable: true },
                payments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      transactionId: { type: 'string' },
                      amount: { type: 'number' },
                      status: { type: 'string' },
                      createdAt: { type: 'string' },
                    },
                  },
                },
                metadata: { type: 'object' },
                rawCreateRequest: { type: 'object', nullable: true },
                rawCreateResponse: { type: 'object', nullable: true },
                rawStatusResponse: { type: 'object', nullable: true },
                rawCancelResponse: { type: 'object', nullable: true },
              },
            },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const { preApprovalId } = request.params as any;
      
      if (!apiKeyId) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication required - missing API key context',
        });
      }

      const result = await preApprovalService.getPreApproval(preApprovalId, apiKeyId);

      if (!result.success) {
        return reply.code(404).send(result);
      }

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get PreApproval');
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  // List PreApprovals
  fastify.get('/preapprovals', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            preApprovals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  preApprovalId: { type: 'string' },
                  referenceId: { type: 'string' },
                  status: { type: 'string' },
                  providerReference: { type: 'string' },
                  payerPhone: { type: 'string' },
                  payerCurrency: { type: 'string' },
                  validityTime: { type: 'number' },
                  expiresAt: { type: 'string' },
                  provider: { type: 'string' },
                  paymentsCount: { type: 'integer' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const { page, limit, status } = request.query as any;
      
      if (!apiKeyId) {
        return reply.code(401).send({
          preApprovals: [],
          total: 0,
          page: 1,
          totalPages: 0,
          error: 'Authentication required - missing API key context',
        });
      }

      const result = await preApprovalService.listPreApprovals(
        apiKeyId,
        page || 1,
        limit || 10,
        status
      );

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list PreApprovals');
      return reply.code(500).send({
        preApprovals: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });
    }
  });
}
