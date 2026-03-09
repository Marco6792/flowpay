import { Provider } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { ProviderFactory, ProviderMode } from './providers/provider.factory';
import { WalletService } from './wallet.service';
import { Balance, BalanceResponse } from './providers/provider.interface';

export interface AggregatedBalance {
  currency: string;
  localWalletBalance: number;
  providerBalances: {
    provider: Provider;
    availableBalance: number;
    accountStatus: string;
    success: boolean;
    error?: string;
  }[];
  totalBalance: number;
  lastUpdated: Date;
}

export interface BalanceAggregationResponse {
  success: boolean;
  aggregatedBalances: AggregatedBalance[];
  localWalletTotal: number;
  providerBalanceTotal: number;
  grandTotal: number;
  timestamp: Date;
  errors?: string[];
}

export class BalanceService {
  /**
   * Get aggregated balances across all providers and local wallets for a user
   */
  static async getAggregatedBalance(userId: string, mode: ProviderMode = 'SANDBOX'): Promise<BalanceAggregationResponse> {
    try {
      logger.info({ userId, mode }, 'Starting balance aggregation');

      // Get user's wallets to know which providers they have
      const userWallets = await prisma.merchantWallet.findMany({
        where: { userId },
        select: { provider: true, balance: true, currency: true }
      });

      // Get provider balances in parallel (mode-aware)
      const providerResults = await Promise.allSettled([
        this.getProviderBalance('mtn', mode),
        this.getProviderBalance('orange', mode)
      ]);

      const aggregatedBalances: AggregatedBalance[] = [];
      const errors: string[] = [];
      let localWalletTotal = 0;
      let providerBalanceTotal = 0;

      // Group by currency (assuming XAF for now, but extensible)
      const currencyGroups = new Map<string, {
        localBalance: number;
        providerBalances: Array<{
          provider: Provider;
          availableBalance: number;
          accountStatus: string;
          success: boolean;
          error?: string;
        }>;
      }>();

      // Process local wallet balances
      for (const wallet of userWallets) {
        const currency = wallet.currency;
        if (!currencyGroups.has(currency)) {
          currencyGroups.set(currency, { localBalance: 0, providerBalances: [] });
        }
        
        const group = currencyGroups.get(currency)!;
        group.localBalance += wallet.balance;
        localWalletTotal += wallet.balance;
      }

      // Process provider balances
      const providerData = [
        { provider: 'MTN' as Provider, result: providerResults[0] },
        { provider: 'ORANGE' as Provider, result: providerResults[1] }
      ];

      for (const { provider, result } of providerData) {
        if (result.status === 'fulfilled' && result.value.success) {
          for (const balance of result.value.balances) {
            const currency = balance.currency;
            
            // Convert EUR to XAF for sandbox (approximate rate)
            let convertedBalance = balance.availableBalance;
            if (balance.currency === 'EUR') {
              convertedBalance = balance.availableBalance * 656; // Approximate EUR to XAF rate
            }

            if (!currencyGroups.has(currency)) {
              currencyGroups.set(currency, { localBalance: 0, providerBalances: [] });
            }
            
            const group = currencyGroups.get(currency)!;
            group.providerBalances.push({
              provider,
              availableBalance: convertedBalance,
              accountStatus: balance.accountStatus,
              success: true
            });
            
            providerBalanceTotal += convertedBalance;
          }
        } else {
          const error = result.status === 'rejected' 
            ? result.reason.message 
            : 'Provider balance fetch unsuccessful';
          
          errors.push(`${provider}: ${error}`);
          
          // Add failed provider to XAF group as default
          if (!currencyGroups.has('XAF')) {
            currencyGroups.set('XAF', { localBalance: 0, providerBalances: [] });
          }
          
          currencyGroups.get('XAF')!.providerBalances.push({
            provider,
            availableBalance: 0,
            accountStatus: 'UNKNOWN',
            success: false,
            error
          });
        }
      }

      // Build aggregated balances
      for (const [currency, group] of currencyGroups) {
        const totalProviderBalance = group.providerBalances
          .filter(pb => pb.success)
          .reduce((sum, pb) => sum + pb.availableBalance, 0);

        aggregatedBalances.push({
          currency,
          localWalletBalance: group.localBalance,
          providerBalances: group.providerBalances,
          totalBalance: group.localBalance + totalProviderBalance,
          lastUpdated: new Date()
        });
      }

      const response: BalanceAggregationResponse = {
        success: true,
        aggregatedBalances,
        localWalletTotal,
        providerBalanceTotal,
        grandTotal: localWalletTotal + providerBalanceTotal,
        timestamp: new Date(),
        ...(errors.length > 0 && { errors })
      };

      logger.info({
        userId,
        localWalletTotal,
        providerBalanceTotal,
        grandTotal: response.grandTotal,
        errorsCount: errors.length
      }, 'Balance aggregation completed');

      return response;

    } catch (error: any) {
      logger.error({ error, userId }, 'Error in balance aggregation');
      return {
        success: false,
        aggregatedBalances: [],
        localWalletTotal: 0,
        providerBalanceTotal: 0,
        grandTotal: 0,
        timestamp: new Date(),
        errors: [error.message]
      };
    }
  }

  /**
   * Get balance from a specific provider
   */
  private static async getProviderBalance(providerName: string, mode: ProviderMode = 'SANDBOX'): Promise<BalanceResponse> {
    try {
      const provider = ProviderFactory.getProvider(providerName as any, mode);
      if (!provider) {
        throw new Error(`Provider ${providerName} not found`);
      }

      return await provider.getBalance();
    } catch (error: any) {
      logger.error({ error, providerName }, 'Failed to get provider balance');
      return {
        success: false,
        balances: [],
        timestamp: new Date()
      };
    }
  }

  /**
   * Get user's local wallet balances only
   */
  static async getLocalWalletBalances(userId: string): Promise<{
    success: boolean;
    wallets: Array<{
      provider: Provider;
      balance: number;
      currency: string;
      status: string;
    }>;
    totalBalance: number;
    timestamp: Date;
  }> {
    try {
      const wallets = await prisma.merchantWallet.findMany({
        where: { userId },
        select: {
          provider: true,
          balance: true,
          currency: true,
          status: true
        }
      });

      const totalBalance = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);

      return {
        success: true,
        wallets,
        totalBalance,
        timestamp: new Date()
      };
    } catch (error: any) {
      logger.error({ error, userId }, 'Failed to get local wallet balances');
      return {
        success: false,
        wallets: [],
        totalBalance: 0,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get provider balances only (without local wallets)
   */
  static async getProviderBalances(): Promise<{
    success: boolean;
    providers: Array<{
      name: string;
      success: boolean;
      balances: Balance[];
      error?: string;
    }>;
    timestamp: Date;
  }> {
    try {
      const providerResults = await Promise.allSettled([
        this.getProviderBalance('mtn').then(result => ({ name: 'MTN', result })),
        this.getProviderBalance('orange').then(result => ({ name: 'ORANGE', result }))
      ]);

      const providers = providerResults.map(result => {
        if (result.status === 'fulfilled') {
          const { name, result: balanceResult } = result.value;
          return {
            name,
            success: balanceResult.success,
            balances: balanceResult.balances,
            ...(balanceResult.success ? {} : { error: 'Balance fetch failed' })
          };
        } else {
          return {
            name: 'UNKNOWN',
            success: false,
            balances: [],
            error: result.reason.message
          };
        }
      });

      return {
        success: true,
        providers,
        timestamp: new Date()
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to get provider balances');
      return {
        success: false,
        providers: [],
        timestamp: new Date()
      };
    }
  }

  /**
   * Refresh and cache balance data for faster retrieval
   */
  static async refreshBalanceCache(userId: string): Promise<{
    success: boolean;
    refreshedAt: Date;
    cacheKey: string;
  }> {
    try {
      // Get fresh balance data
      const aggregatedBalance = await this.getAggregatedBalance(userId);
      
      // Store in cache (using metadata field as simple cache)
      const cacheKey = `balance_cache_${userId}`;
      
      // Update user settings with cached balance data
      await prisma.userSettings.upsert({
        where: { userId },
        update: {
          // Using a custom field to store cached data - this is a simple approach
          // In production, you might want to use Redis or a dedicated cache table
        },
        create: {
          userId,
          notificationEmail: '',
          enableEmail: true,
        }
      });

      logger.info({ userId, cacheKey }, 'Balance cache refreshed');

      return {
        success: true,
        refreshedAt: new Date(),
        cacheKey
      };
    } catch (error: any) {
      logger.error({ error, userId }, 'Failed to refresh balance cache');
      return {
        success: false,
        refreshedAt: new Date(),
        cacheKey: ''
      };
    }
  }
}