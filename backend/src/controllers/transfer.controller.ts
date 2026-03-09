import { FastifyRequest, FastifyReply } from 'fastify';
import { transferService } from '../services/transfer.service.ts';
import { depositService } from '../services/deposit.service.ts';
import { logger } from '../utils/logger.ts';

interface TransferRequest {
  transferId?: string;
  from: string;
  to: string;
  amount: number;
  currency?: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

interface GetTransferParams {
  transferId: string;
}

interface GetTransferStatusParams {
  transferId: string;
}

interface ListTransfersQuery {
  page?: string;
  limit?: string;
  status?: string;
}

interface ValidateRecipientBody {
  accountId: string;
  provider?: string;
}

interface GetUserInfoBody {
  accountId: string;
  provider?: string;
}

interface GetBalanceQuery {
  provider?: string;
}

interface DepositBody {
  depositId?: string;
  accountId: string;
  amount: number;
  currency?: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

interface GetDepositStatusParams {
  depositId: string;
}

export class TransferController {
  /**
   * Create a new transfer
   */
  async createTransfer(request: FastifyRequest, reply: FastifyReply) {
    try {
      const transferData = request.body as TransferRequest;
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;

      // Validate required fields
      if (!transferData.from || !transferData.to || !transferData.amount) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: from, to, amount',
        });
      }

      if (transferData.amount <= 0) {
        return reply.status(400).send({
          success: false,
          error: 'Amount must be greater than 0',
        });
      }

      const result = await transferService.createTransfer(apiKeyId, userId, {
        transferId: transferData.transferId || `ft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        from: transferData.from,
        to: transferData.to,
        amount: transferData.amount,
        currency: transferData.currency || 'XAF',
        description: transferData.description,
        provider: transferData.provider || 'MTN',
        metadata: transferData.metadata,
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
        flowpay: result.transfer ? {
          transferId: result.transfer.transferId,
          status: result.transfer.status,
          amount: result.transfer.amount,
          currency: result.transfer.currency,
          from: result.transfer.from,
          to: result.transfer.to,
          description: result.transfer.description || null,
          fee: result.transfer.fee || null,
          providerReference: result.transfer.providerReference,
          financialTransactionId: result.transfer.financialTransactionId, // Include MTN's financial transaction ID
          createdAt: result.transfer.createdAt,
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
      logger.error({ error }, 'Transfer creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get transfer by ID
   */
  async getTransfer(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { transferId } = request.params as GetTransferParams;
      const apiKeyId = (request as any).apiKey?.id;

      const result = await transferService.getTransfer(transferId, apiKeyId);

      if (!result.success) {
        return reply.status(404).send({
          success: false,
          error: result.error || 'Transfer not found',
        });
      }

      const transfer = result.transfer;
      const responseData = {
        transferId: transfer.transferId,
        status: transfer.status,
        amount: transfer.amount,
        currency: transfer.currency,
        from: transfer.from,
        to: transfer.to,
        description: transfer.description || null,
        fee: transfer.fee || null,
        providerReference: transfer.providerReference,
        financialTransactionId: transfer.financialTransactionId, // Include MTN's financial transaction ID
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt,
        completedAt: transfer.completedAt,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get transfer');

      if (error.message === 'Transfer not found') {
        return reply.status(404).send({
          success: false,
          error: 'Transfer not found',
        });
      }

      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get transfer status
   */
  async getTransferStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { transferId } = request.params as GetTransferStatusParams;
      const apiKeyId = (request as any).apiKey?.id;

      const status = await transferService.getTransferStatus(transferId, apiKeyId);

      const responseData = {
        transferId: status.transferId,
        providerTransferId: status.providerTransferId,
        status: status.status,
        amount: status.amount,
        fee: status.fee || null,
        completedAt: status.completedAt,
        failureReason: status.failureReason || null,
        financialTransactionId: status.financialTransactionId, // Include MTN's financial transaction ID
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get transfer status');

      if (error.message === 'Transfer not found' || error.message === 'Transfer not yet processed by provider') {
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
   * List transfers
   */
  async listTransfers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { page = '1', limit = '10', status } = request.query as ListTransfersQuery;
      const apiKeyId = (request as any).apiKey?.id;

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid page or limit parameters',
        });
      }

      const result = await transferService.listTransfers(apiKeyId, pageNum, limitNum, status);

      const responseData = {
        transfers: result.transfers.map(transfer => ({
          transferId: transfer.transferId,
          status: transfer.status,
          amount: transfer.amount,
          currency: transfer.currency,
          from: transfer.from,
          to: transfer.to,
          description: transfer.description || null,
          fee: transfer.fee || null,
          providerReference: transfer.providerReference,
          financialTransactionId: transfer.financialTransactionId, // Include MTN's financial transaction ID
          createdAt: transfer.createdAt,
          completedAt: transfer.completedAt,
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
      logger.error({ error }, 'Failed to list transfers');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get account balance
   */
  async getBalance(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { provider = 'MTN' } = request.query as GetBalanceQuery;

      const balance = await transferService.getBalance(provider);

      const responseData = {
        balances: balance.balances,
        timestamp: balance.timestamp,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get balance');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Validate recipient account
   */
  async validateRecipient(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { accountId, provider = 'MTN' } = request.body as ValidateRecipientBody;

      if (!accountId) {
        return reply.status(400).send({
          success: false,
          error: 'accountId is required',
        });
      }

      const validation = await transferService.validateRecipient(accountId, provider);

      const responseData = {
        accountId,
        isActive: validation.isActive,
        accountHolder: validation.accountHolder || null,
        message: validation.message || null,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to validate recipient');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { accountId, provider = 'MTN' } = request.body as GetUserInfoBody;

      if (!accountId) {
        return reply.status(400).send({
          success: false,
          error: 'accountId is required',
        });
      }

      const userInfo = await transferService.getUserInfo(accountId, provider);

      if (!userInfo.success) {
        return reply.status(400).send({
          success: false,
          error: userInfo.message,
        });
      }

      const responseData = {
        accountId,
        userInfo: userInfo.userInfo,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get user info');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Create a deposit
   */
  async createDeposit(request: FastifyRequest, reply: FastifyReply) {
    try {
      const depositData = request.body as DepositBody;

      // Validate required fields
      if (!depositData.accountId || !depositData.amount) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: accountId, amount',
        });
      }

      if (depositData.amount <= 0) {
        return reply.status(400).send({
          success: false,
          error: 'Amount must be greater than 0',
        });
      }

      const result = await depositService.createDeposit(
        (request as any).apiKey?.id,
        (request as any).user?.userId || null,
        {
          depositId: depositData.depositId || `dp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          accountId: depositData.accountId,
          amount: depositData.amount,
          currency: depositData.currency || 'XAF',
          description: depositData.description,
          provider: depositData.provider || 'MTN',
          metadata: depositData.metadata,
        }
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
        });
      }

      // Construct response data with proper null handling
      const responseData = {
        // FlowPay processed data
        flowpay: result.deposit ? {
          depositId: result.deposit.depositId,
          status: result.deposit.status,
          amount: result.deposit.amount,
          currency: result.deposit.currency,
          accountId: result.deposit.accountId,
          description: result.deposit.description || null,
          fee: result.deposit.fee || null,
          providerReference: result.deposit.providerReference,
          financialTransactionId: result.rawProviderResponse?.financialTransactionId || null, // Include MTN's financial transaction ID
          createdAt: result.deposit.createdAt,
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
      logger.error({ error }, 'Deposit creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get deposit status
   */
  async getDepositStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { depositId } = request.params as GetDepositStatusParams;
      const apiKeyId = (request as any).apiKey?.id;

      const result = await depositService.getDepositStatus(depositId, apiKeyId);

      if (!result.success) {
        return reply.status(404).send({
          success: false,
          error: result.error || 'Deposit not found',
        });
      }

      const responseData = {
        depositId: result.depositId,
        providerDepositId: result.providerDepositId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        accountId: result.accountId,
        fee: result.fee || null,
        completedAt: result.completedAt,
        failureReason: result.failureReason || null,
        financialTransactionId: result.financialTransactionId || null,
        lastUpdated: result.lastUpdated,
        cached: result.cached || false,
      };

      const finalResponse = {
        success: true,
        data: responseData,
      };

      reply.header('Content-Type', 'application/json');
      return reply.send(JSON.stringify(finalResponse));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get deposit status');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }
}

export const transferController = new TransferController();
