import { FastifyRequest, FastifyReply } from 'fastify';
import { withdrawalService } from '../services/withdrawal.service.ts';
import { logger } from '../utils/logger.ts';

interface WithdrawalRequest {
  withdrawId?: string;
  accountId: string;
  amount: number;
  currency?: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

interface GetWithdrawalParams {
  withdrawId: string;
}

interface GetWithdrawalStatusParams {
  withdrawId: string;
}

interface ListWithdrawalsQuery {
  page?: string;
  limit?: string;
  status?: string;
}

export class WithdrawalController {
  /**
   * Create a new withdrawal
   */
  async createWithdrawal(request: FastifyRequest, reply: FastifyReply) {
    try {
      const withdrawalData = request.body as WithdrawalRequest;
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;

      // Validate required fields
      if (!withdrawalData.accountId || !withdrawalData.amount) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: accountId, amount',
        });
      }

      if (withdrawalData.amount <= 0) {
        return reply.status(400).send({
          success: false,
          error: 'Amount must be greater than 0',
        });
      }

      const result = await withdrawalService.createWithdrawal(apiKeyId, userId, {
        withdrawId: withdrawalData.withdrawId || `wd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        accountId: withdrawalData.accountId,
        amount: withdrawalData.amount,
        currency: withdrawalData.currency || 'XAF',
        description: withdrawalData.description,
        provider: withdrawalData.provider || 'MTN',
        metadata: withdrawalData.metadata,
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      // Construct response data with proper null handling
      const responseData = {
        // FlowPay processed data
        flowpay: result.withdrawal ? {
          withdrawId: result.withdrawal.withdrawId,
          status: result.withdrawal.status,
          amount: result.withdrawal.amount,
          currency: result.withdrawal.currency,
          accountId: result.withdrawal.accountId,
          description: result.withdrawal.description || null,
          fee: result.withdrawal.fee || null,
          providerReference: result.withdrawal.providerReference,
          createdAt: result.withdrawal.createdAt,
        } : null,
        // Raw MTN provider response
        provider: result.rawProviderResponse || null,
      };

      // Create clean response and send as stringified JSON to bypass serialization issues
      const finalResponse = {
        success: true,
        data: responseData,
      };

      const cleanResponse = JSON.parse(JSON.stringify(finalResponse));

      reply.status(201);
      reply.header('Content-Type', 'application/json');

      const responseBody = JSON.stringify(cleanResponse);

      return reply.send(responseBody);
    } catch (error: any) {
      logger.error({ error }, 'Withdrawal creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get withdrawal by ID
   */
  async getWithdrawal(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { withdrawId } = request.params as GetWithdrawalParams;
      const apiKeyId = (request as any).apiKey?.id;

      const result = await withdrawalService.getWithdrawal(withdrawId, apiKeyId);

      if (!result.success) {
        return reply.status(404).send({
          success: false,
          error: result.error || 'Withdrawal not found',
        });
      }

      const withdrawal = result.withdrawal;
      const responseData = {
        withdrawId: withdrawal.withdrawId,
        status: withdrawal.status,
        amount: withdrawal.amount,
        currency: withdrawal.currency,
        accountId: withdrawal.accountId,
        description: withdrawal.description || null,
        fee: withdrawal.fee || null,
        providerReference: withdrawal.providerReference,
        financialTransactionId: withdrawal.financialTransactionId, // Include MTN's financial transaction ID
        createdAt: withdrawal.createdAt,
        updatedAt: withdrawal.updatedAt,
        completedAt: withdrawal.completedAt,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get withdrawal');

      if (error.message === 'Withdrawal not found') {
        return reply.status(404).send({
          success: false,
          error: 'Withdrawal not found',
        });
      }

      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get withdrawal status
   */
  async getWithdrawalStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { withdrawId } = request.params as GetWithdrawalStatusParams;
      const apiKeyId = (request as any).apiKey?.id;

      const status = await withdrawalService.getWithdrawalStatus(withdrawId, apiKeyId);

      const responseData = {
        withdrawId: status.withdrawId,
        providerWithdrawId: status.providerWithdrawId,
        status: status.status,
        amount: status.amount,
        fee: status.fee || null,
        completedAt: status.completedAt,
        failureReason: status.failureReason || null,
        financialTransactionId: (status as any).financialTransactionId || null,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get withdrawal status');

      if (error.message === 'Withdrawal not found' || error.message === 'Withdrawal not yet processed by provider') {
        return reply.status(404).send({
          success: false,
          error: error.message,
        });
      }

      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * List withdrawals
   */
  async listWithdrawals(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { page = '1', limit = '10', status } = request.query as ListWithdrawalsQuery;
      const apiKeyId = (request as any).apiKey?.id;

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid page or limit parameters',
        });
      }

      const result = await withdrawalService.listWithdrawals(apiKeyId, pageNum, limitNum, status);

      const responseData = {
        withdrawals: result.withdrawals.map(withdrawal => ({
          withdrawId: withdrawal.withdrawId,
          status: withdrawal.status,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          accountId: withdrawal.accountId,
          description: withdrawal.description || null,
          fee: withdrawal.fee || null,
          providerReference: withdrawal.providerReference,
          financialTransactionId: (withdrawal as any).financialTransactionId || null,
          createdAt: withdrawal.createdAt,
          completedAt: withdrawal.completedAt,
        })),
        pagination: {
          page: result.page,
          limit: limitNum,
          total: result.total,
          totalPages: result.totalPages,
        },
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to list withdrawals');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }
}

export const withdrawalController = new WithdrawalController();
