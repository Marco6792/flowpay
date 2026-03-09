import { Provider } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export class WalletService {
  /**
   * Get or create a merchant wallet for a specific provider
   */
  static async getOrCreateWallet(userId: string, provider: Provider) {
    try {
      let wallet = await prisma.merchantWallet.findUnique({
        where: {
          userId_provider: {
            userId,
            provider,
          },
        },
      });

      if (!wallet) {
        wallet = await prisma.merchantWallet.create({
          data: {
            userId,
            provider,
            balance: 0,
            currency: 'XAF',
            status: 'ACTIVE',
          },
        });

        logger.info({ userId, provider }, 'Created new merchant wallet');
      }

      return wallet;
    } catch (error) {
      logger.error({ error, userId, provider }, 'Error getting/creating wallet');
      throw error;
    }
  }

  /**
   * Process a payment and create wallet transaction
   */
  static async processPaymentTransaction(
    userId: string,
    provider: Provider,
    amount: number,
    fee: number,
    netAmount: number,
    paymentId: string,
    transactionId: string
  ) {
    try {
      // Safety check: Verify payment is actually completed before processing
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { status: true, transactionId: true }
      });

      if (!payment) {
        throw new Error(`Payment ${paymentId} not found`);
      }

      if (payment.status !== 'COMPLETED') {
        logger.warn({ 
          paymentId, 
          status: payment.status, 
          transactionId: payment.transactionId 
        }, 'Attempt to process wallet transaction for non-completed payment - blocking');
        throw new Error(`Cannot process wallet transaction for payment with status: ${payment.status}`);
      }

      // Additional safety check for test scenarios
      if (payment.transactionId.includes('failed_test') || 
          payment.transactionId.includes('rejected_test') ||
          payment.transactionId.includes('timeout_test')) {
        logger.error({ 
          paymentId, 
          transactionId: payment.transactionId,
          status: payment.status
        }, 'CRITICAL: Attempt to credit wallet for failed test payment - blocking');
        throw new Error(`Cannot credit wallet for test failure scenario: ${payment.transactionId}`);
      }

      // Get or create the merchant's wallet
      const wallet = await this.getOrCreateWallet(userId, provider);

      // Start a transaction to ensure consistency
      const result = await prisma.$transaction(async (tx) => {
        // Create wallet transaction for the credit
        const walletTransaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'CREDIT',
            amount: netAmount, // Credit the net amount after fees
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + netAmount,
            reference: `PAY-${transactionId}`,
            description: `Payment received: ${transactionId}`,
            metadata: {
              paymentId,
              grossAmount: amount,
              fee,
              provider,
            },
          },
        });

        // Update wallet balance
        const updatedWallet = await tx.merchantWallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              increment: netAmount,
            },
          },
        });

        // If there's a fee, create a separate fee transaction
        if (fee > 0) {
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'FEE',
              amount: fee,
              balanceBefore: updatedWallet.balance,
              balanceAfter: updatedWallet.balance, // Fee doesn't affect balance as it's already deducted
              reference: `FEE-${transactionId}`,
              description: `Transaction fee for: ${transactionId}`,
              metadata: {
                paymentId,
                relatedTransactionId: walletTransaction.id,
              },
            },
          });
        }

        // Update the payment with the wallet transaction ID
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            walletTransactionId: walletTransaction.id,
          },
        });

        logger.info({
          userId,
          paymentId,
          walletTransactionId: walletTransaction.id,
          netAmount,
          newBalance: updatedWallet.balance,
        }, 'Wallet transaction created for payment');

        return walletTransaction;
      });

      return result;
    } catch (error) {
      logger.error({ error, userId, paymentId }, 'Error processing wallet transaction');
      throw error;
    }
  }

  /**
   * Get wallet balance for a user
   */
  static async getWalletBalance(userId: string, provider?: Provider) {
    try {
      if (provider) {
        const wallet = await prisma.merchantWallet.findUnique({
          where: {
            userId_provider: {
              userId,
              provider,
            },
          },
        });

        return wallet ? wallet.balance : 0;
      }

      // Get total balance across all wallets
      const wallets = await prisma.merchantWallet.findMany({
        where: { userId },
      });

      return wallets.reduce((total, wallet) => total + wallet.balance, 0);
    } catch (error) {
      logger.error({ error, userId }, 'Error getting wallet balance');
      throw error;
    }
  }

  /**
   * Get wallet transaction history
   */
  static async getTransactionHistory(
    userId: string,
    provider?: Provider,
    limit = 50,
    offset = 0
  ) {
    try {
      const walletFilter = provider
        ? { userId, provider }
        : { userId };

      const wallets = await prisma.merchantWallet.findMany({
        where: walletFilter,
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          },
        },
      });

      // Flatten transactions from all wallets
      const transactions = wallets.flatMap(w => w.transactions);

      // Sort by creation date
      transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return transactions.slice(0, limit);
    } catch (error) {
      logger.error({ error, userId }, 'Error getting transaction history');
      throw error;
    }
  }

  /**
   * Process a settlement (withdrawal) from wallet
   */
  static async processSettlement(
    userId: string,
    provider: Provider,
    amount: number,
    settlementId: string
  ) {
    try {
      const wallet = await this.getOrCreateWallet(userId, provider);

      if (wallet.balance < amount) {
        throw new Error('Insufficient wallet balance');
      }

      const walletTransaction = await prisma.$transaction(async (tx) => {
        // Create debit transaction
        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'SETTLEMENT',
            amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance - amount,
            reference: `SETTLE-${settlementId}`,
            description: `Settlement withdrawal`,
            metadata: {
              settlementId,
            },
          },
        });

        // Update wallet balance
        await tx.merchantWallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              decrement: amount,
            },
          },
        });

        return transaction;
      });

      logger.info({
        userId,
        settlementId,
        amount,
        walletTransactionId: walletTransaction.id,
      }, 'Settlement processed from wallet');

      return walletTransaction;
    } catch (error) {
      logger.error({ error, userId, settlementId }, 'Error processing settlement');
      throw error;
    }
  }
}
