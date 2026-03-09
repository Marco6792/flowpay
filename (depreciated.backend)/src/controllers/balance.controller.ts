import { FastifyRequest, FastifyReply } from 'fastify';
import { BalanceService } from '../services/balance.service.ts';
import { WalletService } from '../services/wallet.service.ts';
import { logger } from '../utils/logger.ts';
import { prisma } from '../utils/database.ts';
import { Provider } from '@prisma/client';

export class BalanceController {
  /**
   * Get aggregated balances across all providers and local wallets
   * GET /api/v1/balance/aggregated
   */
  async getAggregatedBalance(request: FastifyRequest, reply: FastifyReply) {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;

      if (!apiKeyId || !userId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required - missing API key or user context',
        });
      }

      logger.info({ userId, apiKeyId }, 'Getting aggregated balance');

      const aggregatedBalance = await BalanceService.getAggregatedBalance(userId);

      return {
        success: aggregatedBalance.success,
        data: {
          balances: aggregatedBalance.aggregatedBalances,
          summary: {
            localWalletTotal: aggregatedBalance.localWalletTotal,
            providerBalanceTotal: aggregatedBalance.providerBalanceTotal,
            grandTotal: aggregatedBalance.grandTotal,
          },
          timestamp: aggregatedBalance.timestamp,
          ...(aggregatedBalance.errors && { errors: aggregatedBalance.errors })
        }
      };
    } catch (error: any) {
      logger.error({ error }, 'Error getting aggregated balance');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Get local wallet balances only
   * GET /api/v1/balance/wallets
   */
  async getWalletBalances(request: FastifyRequest, reply: FastifyReply) {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;

      if (!apiKeyId || !userId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required - missing API key or user context',
        });
      }

      logger.info({ userId, apiKeyId }, 'Getting wallet balances');

      const walletBalances = await BalanceService.getLocalWalletBalances(userId);

      return {
        success: walletBalances.success,
        data: {
          wallets: walletBalances.wallets,
          totalBalance: walletBalances.totalBalance,
          timestamp: walletBalances.timestamp
        }
      };
    } catch (error: any) {
      logger.error({ error }, 'Error getting wallet balances');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Get provider balances only
   * GET /api/v1/balance/providers
   */
  async getProviderBalances(request: FastifyRequest, reply: FastifyReply) {
    try {
      const apiKeyId = (request as any).apiKey?.id;

      if (!apiKeyId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'API key required',
        });
      }

      logger.info({ apiKeyId }, 'Getting provider balances');

      const providerBalances = await BalanceService.getProviderBalances();

      return {
        success: providerBalances.success,
        data: {
          providers: providerBalances.providers,
          timestamp: providerBalances.timestamp
        }
      };
    } catch (error: any) {
      logger.error({ error }, 'Error getting provider balances');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Get balance for specific provider
   * GET /api/v1/balance/provider/:provider
   */
  async getProviderBalance(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { provider } = request.params as { provider: string };
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;

      if (!apiKeyId || !userId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required - missing API key or user context',
        });
      }

      // Validate provider
      const validProviders = ['MTN', 'ORANGE'];
      const normalizedProvider = provider.toUpperCase();
      
      if (!validProviders.includes(normalizedProvider)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid provider. Supported providers: ${validProviders.join(', ')}`
        });
      }

      logger.info({ userId, apiKeyId, provider: normalizedProvider }, 'Getting specific provider balance');

      // Get local wallet balance for this provider
      const localBalance = await WalletService.getWalletBalance(
        userId, 
        normalizedProvider as Provider
      );

      // Get provider balance
      const providerBalances = await BalanceService.getProviderBalances();
      const specificProvider = providerBalances.providers.find(
        p => p.name === normalizedProvider
      );

      return {
        success: true,
        data: {
          provider: normalizedProvider,
          localWalletBalance: localBalance,
          providerBalance: specificProvider?.success 
            ? specificProvider.balances[0]?.availableBalance || 0
            : 0,
          providerStatus: specificProvider?.success 
            ? (specificProvider.balances[0]?.accountStatus || 'UNKNOWN')
            : 'ERROR',
          totalBalance: localBalance + (specificProvider?.success 
            ? (specificProvider.balances[0]?.availableBalance || 0)
            : 0),
          timestamp: new Date(),
          ...(specificProvider?.error && { providerError: specificProvider.error })
        }
      };
    } catch (error: any) {
      logger.error({ error }, 'Error getting provider balance');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Refresh balance cache
   * POST /api/v1/balance/refresh
   */
  async refreshBalance(request: FastifyRequest, reply: FastifyReply) {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;

      if (!apiKeyId || !userId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required - missing API key or user context',
        });
      }

      logger.info({ userId, apiKeyId }, 'Refreshing balance cache');

      const cacheResult = await BalanceService.refreshBalanceCache(userId);
      const aggregatedBalance = await BalanceService.getAggregatedBalance(userId);

      return {
        success: cacheResult.success,
        data: {
          refreshed: cacheResult.success,
          refreshedAt: cacheResult.refreshedAt,
          balances: aggregatedBalance.aggregatedBalances,
          summary: {
            localWalletTotal: aggregatedBalance.localWalletTotal,
            providerBalanceTotal: aggregatedBalance.providerBalanceTotal,
            grandTotal: aggregatedBalance.grandTotal,
          }
        }
      };
    } catch (error: any) {
      logger.error({ error }, 'Error refreshing balance');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }

  /**
   * Get wallet transaction history
   * GET /api/v1/balance/transactions
   */
  async getTransactionHistory(request: FastifyRequest, reply: FastifyReply) {
    try {
      const apiKeyId = (request as any).apiKey?.id;
      const userId = (request as any).user?.userId;
      const query = request.query as {
        provider?: string;
        limit?: string;
        offset?: string;
      };

      if (!apiKeyId || !userId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required - missing API key or user context',
        });
      }

      const limit = parseInt(query.limit || '50', 10);
      const offset = parseInt(query.offset || '0', 10);
      const provider = query.provider ? query.provider.toUpperCase() as Provider : undefined;

      logger.info({ userId, apiKeyId, provider, limit, offset }, 'Getting wallet transaction history');

      const transactions = await WalletService.getTransactionHistory(
        userId,
        provider,
        limit,
        offset
      );

      return {
        success: true,
        data: {
          transactions: transactions.map(tx => ({
            id: tx.id,
            type: tx.type,
            amount: tx.amount,
            balanceBefore: tx.balanceBefore,
            balanceAfter: tx.balanceAfter,
            reference: tx.reference,
            description: tx.description,
            metadata: tx.metadata,
            createdAt: tx.createdAt.toISOString()
          })),
          pagination: {
            limit,
            offset,
            count: transactions.length,
            hasMore: transactions.length === limit
          }
        }
      };
    } catch (error: any) {
      logger.error({ error }, 'Error getting transaction history');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      });
    }
  }
}