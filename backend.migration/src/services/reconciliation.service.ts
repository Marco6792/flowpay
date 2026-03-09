import { ReconciliationStatus } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { ProviderFactory } from './providers/provider.factory';
import { AuditService } from './audit.service';

export interface ReconciliationResult {
  totalPayments: number;
  matched: number;
  mismatched: number;
  missing: number;
  discrepancies: ReconciliationDiscrepancy[];
}

export interface ReconciliationDiscrepancy {
  paymentId: string;
  transactionId: string;
  type: 'amount_mismatch' | 'status_mismatch' | 'missing_in_provider' | 'missing_in_database';
  expected: any;
  actual: any;
  difference?: number;
}

export class ReconciliationService {
  /**
   * Run daily reconciliation for all providers
   */
  static async runDailyReconciliation(date?: Date): Promise<void> {
    const reconciliationDate = date || new Date();
    const startOfDay = new Date(reconciliationDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reconciliationDate);
    endOfDay.setHours(23, 59, 59, 999);

    logger.info({ date: startOfDay.toISOString() }, 'Starting daily reconciliation');

    try {
      // Create reconciliation record
      const reconciliation = await prisma.reconciliation.create({
        data: {
          date: startOfDay,
          provider: 'MTN', // Default provider, will be updated
          totalTransactions: 0,
          totalAmount: 0,
          reconciledCount: 0,
          status: ReconciliationStatus.IN_PROGRESS,
        },
      });

      // Reconcile each provider
      const results: Record<string, ReconciliationResult> = {};

      // Reconcile MTN payments
      const mtnResult = await this.reconcileProvider('mtn', startOfDay, endOfDay);
      results.mtn = mtnResult;

      // Reconcile Orange payments
      const orangeResult = await this.reconcileProvider('orange', startOfDay, endOfDay);
      results.orange = orangeResult;

      // Calculate totals
      const totalPayments = mtnResult.totalPayments + orangeResult.totalPayments;
      const totalMatched = mtnResult.matched + orangeResult.matched;
      const totalMismatched = mtnResult.mismatched + orangeResult.mismatched;
      const totalMissing = mtnResult.missing + orangeResult.missing;
      const allDiscrepancies = [...mtnResult.discrepancies, ...orangeResult.discrepancies];

      // Update reconciliation record
      await prisma.reconciliation.update({
        where: { id: reconciliation.id },
        data: {
          status: allDiscrepancies.length > 0 ? ReconciliationStatus.FAILED : ReconciliationStatus.COMPLETED,
          totalTransactions: totalPayments,
          totalAmount: 0, // Will be calculated from payments
          reconciledCount: totalMatched,
          discrepancies: allDiscrepancies as any,
          completedAt: new Date(),
        },
      });

      // Log results
      logger.info({
        reconciliationId: reconciliation.id,
        totalPayments,
        matched: totalMatched,
        mismatched: totalMismatched,
        missing: totalMissing,
        discrepanciesCount: allDiscrepancies.length,
      }, 'Daily reconciliation completed');

      // Log audit event
      await AuditService.log({
        action: 'reconciliation.completed',
        entityType: 'reconciliation',
        entityId: reconciliation.id,
        metadata: {
          date: startOfDay.toISOString(),
          totalPayments,
          discrepanciesFound: allDiscrepancies.length,
        },
      });

      // Send alerts if discrepancies found
      if (allDiscrepancies.length > 0) {
        await this.sendDiscrepancyAlerts(reconciliation.id, allDiscrepancies);
      }
    } catch (error) {
      logger.error({ error, date: startOfDay.toISOString() }, 'Error during daily reconciliation');
      throw error;
    }
  }

  /**
   * Reconcile payments for a specific provider
   */
  private static async reconcileProvider(
    providerType: 'mtn' | 'orange',
    startDate: Date,
    endDate: Date
  ): Promise<ReconciliationResult> {
    const provider = ProviderFactory.getProvider(providerType, 'SANDBOX');
    if (!provider) {
      logger.warn({ provider: providerType }, 'Provider not configured for reconciliation');
      return {
        totalPayments: 0,
        matched: 0,
        mismatched: 0,
        missing: 0,
        discrepancies: [],
      };
    }

    // Get payments from database
    const dbPayments = await prisma.payment.findMany({
      where: {
        provider: providerType === 'mtn' ? 'MTN' : 'ORANGE',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Get transactions from provider
    const providerTransactions = await provider.getTransactions(startDate, endDate);

    // Create maps for efficient lookup
    const dbPaymentMap = new Map(dbPayments.map(p => [p.transactionId, p]));
    const providerTransactionMap = new Map(providerTransactions.map(t => [t.transactionId, t]));

    const discrepancies: ReconciliationDiscrepancy[] = [];
    let matched = 0;
    let mismatched = 0;

    // Check database payments against provider
    for (const dbPayment of dbPayments) {
      const providerTx = providerTransactionMap.get(dbPayment.transactionId);

      if (!providerTx) {
        // Payment missing in provider
        discrepancies.push({
          paymentId: dbPayment.id,
          transactionId: dbPayment.transactionId,
          type: 'missing_in_provider',
          expected: dbPayment,
          actual: null,
        });
        mismatched++;
      } else {
        // Compare payment details
        let hasDiscrepancy = false;

        // Check amount
        if (Math.abs(dbPayment.amount - providerTx.amount) > 0.01) {
          discrepancies.push({
            paymentId: dbPayment.id,
            transactionId: dbPayment.transactionId,
            type: 'amount_mismatch',
            expected: dbPayment.amount,
            actual: providerTx.amount,
            difference: providerTx.amount - dbPayment.amount,
          });
          hasDiscrepancy = true;
        }

        // Check status
        const dbStatus = dbPayment.status.toLowerCase();
        const providerStatus = providerTx.status.toLowerCase();
        if (dbStatus !== providerStatus &&
            !(dbStatus === 'completed' && providerStatus === 'successful')) {
          discrepancies.push({
            paymentId: dbPayment.id,
            transactionId: dbPayment.transactionId,
            type: 'status_mismatch',
            expected: dbPayment.status,
            actual: providerTx.status,
          });
          hasDiscrepancy = true;
        }

        if (hasDiscrepancy) {
          mismatched++;
        } else {
          matched++;
        }
      }
    }

    // Check for provider transactions missing in database
    let missing = 0;
    for (const providerTx of providerTransactions) {
      if (!dbPaymentMap.has(providerTx.transactionId)) {
        discrepancies.push({
          paymentId: '',
          transactionId: providerTx.transactionId,
          type: 'missing_in_database',
          expected: null,
          actual: providerTx,
        });
        missing++;
      }
    }

    return {
      totalPayments: dbPayments.length,
      matched,
      mismatched,
      missing,
      discrepancies,
    };
  }

  /**
   * Send alerts for discrepancies found
   */
  private static async sendDiscrepancyAlerts(
    reconciliationId: string,
    discrepancies: ReconciliationDiscrepancy[]
  ): Promise<void> {
    // Group discrepancies by type
    const byType = discrepancies.reduce((acc, d) => {
      if (!acc[d.type]) acc[d.type] = [];
      acc[d.type].push(d);
      return acc;
    }, {} as Record<string, ReconciliationDiscrepancy[]>);

    // Create notification
    await prisma.notification.create({
      data: {
        userId: '1', // Admin user ID - should be dynamic
        type: 'SYSTEM_ALERT',
        title: `Reconciliation Alert: ${discrepancies.length} discrepancies found`,
        message: `Found ${discrepancies.length} discrepancies during reconciliation`,
        metadata: {
          reconciliationId,
          discrepancyCount: discrepancies.length,
          summary: {
            total: discrepancies.length,
            amountMismatch: byType.amount_mismatch?.length || 0,
            statusMismatch: byType.status_mismatch?.length || 0,
            missingInProvider: byType.missing_in_provider?.length || 0,
            missingInDatabase: byType.missing_in_database?.length || 0,
          },
        } as any,
      },
    });

    logger.warn({
      reconciliationId,
      discrepanciesCount: discrepancies.length,
      types: Object.keys(byType),
    }, 'Reconciliation discrepancies alert sent');
  }

  /**
   * Manually reconcile a specific payment
   */
  static async reconcilePayment(paymentId: string): Promise<ReconciliationDiscrepancy | null> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    const providerType = payment.provider === 'MTN' ? 'mtn' : 'orange';
    const provider = ProviderFactory.getProvider(providerType, 'SANDBOX');

    if (!provider) {
      throw new Error('Provider not configured');
    }

    // Check payment status with provider
    const providerStatus = await provider.checkStatus(payment.transactionId);

    // Compare status
    if (providerStatus.status.toLowerCase() !== payment.status.toLowerCase()) {
      return {
        paymentId: payment.id,
        transactionId: payment.transactionId,
        type: 'status_mismatch',
        expected: payment.status,
        actual: providerStatus.status,
      };
    }

    return null;
  }

  /**
   * Get reconciliation history
   */
  static async getReconciliationHistory(limit = 30): Promise<any[]> {
    const reconciliations = await prisma.reconciliation.findMany({
      orderBy: { date: 'desc' },
      take: limit,
    });

    return reconciliations.map(r => ({
      id: r.id,
      date: r.date.toISOString(),
      status: r.status,
      totalTransactions: r.totalTransactions,
      totalAmount: r.totalAmount,
      reconciledCount: r.reconciledCount,
      discrepanciesCount: (r.discrepancies as any[])?.length || 0,
      completedAt: r.completedAt?.toISOString(),
    }));
  }

  /**
   * Resolve a discrepancy
   */
  static async resolveDiscrepancy(
    reconciliationId: string,
    discrepancyIndex: number,
    resolution: string
  ): Promise<void> {
    const reconciliation = await prisma.reconciliation.findUnique({
      where: { id: reconciliationId },
    });

    if (!reconciliation) {
      throw new Error('Reconciliation not found');
    }

    const discrepancies = (reconciliation.discrepancies as unknown) as ReconciliationDiscrepancy[];
    if (discrepancyIndex >= discrepancies.length) {
      throw new Error('Invalid discrepancy index');
    }

    // Mark discrepancy as resolved
    discrepancies[discrepancyIndex] = {
      ...discrepancies[discrepancyIndex],
      resolved: true,
      resolution,
      resolvedAt: new Date().toISOString(),
    } as any;

    // Check if all discrepancies are resolved
    const allResolved = discrepancies.every((d: any) => d.resolved);

    await prisma.reconciliation.update({
      where: { id: reconciliationId },
      data: {
        discrepancies: discrepancies as any,
        status: allResolved ? ReconciliationStatus.COMPLETED : ReconciliationStatus.FAILED,
      },
    });

    logger.info({
      reconciliationId,
      discrepancyIndex,
      resolution,
    }, 'Discrepancy resolved');
  }
}
