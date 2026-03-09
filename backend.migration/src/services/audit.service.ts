import { AuditLog } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string;
  paymentId?: string;
  oldValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
}

export class AuditService {
  /**
   * Create an audit log entry
   */
  static async log(entry: AuditEntry): Promise<AuditLog> {
    try {
      const auditLog = await prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          userId: entry.userId,
          paymentId: entry.paymentId,
          oldValue: entry.oldValue ? JSON.parse(JSON.stringify(entry.oldValue)) : null,
          newValue: entry.newValue ? JSON.parse(JSON.stringify(entry.newValue)) : null,
          metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : null,
        },
      });

      logger.info({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
      }, 'Audit log created');

      return auditLog;
    } catch (error) {
      logger.error({ error, entry }, 'Failed to create audit log');
      throw error;
    }
  }

  /**
   * Log payment creation
   */
  static async logPaymentCreated(payment: any, userId?: string, metadata?: any): Promise<void> {
    await this.log({
      action: 'payment.created',
      entityType: 'payment',
      entityId: payment.id,
      paymentId: payment.id,
      userId,
      newValue: payment,
      metadata,
    });
  }

  /**
   * Log payment status update
   */
  static async logPaymentStatusUpdate(
    paymentId: string,
    oldStatus: string,
    newStatus: string,
    metadata?: any
  ): Promise<void> {
    await this.log({
      action: 'payment.status_updated',
      entityType: 'payment',
      entityId: paymentId,
      paymentId,
      oldValue: { status: oldStatus },
      newValue: { status: newStatus },
      metadata,
    });
  }

  /**
   * Log API key creation
   */
  static async logApiKeyCreated(apiKey: any, userId: string): Promise<void> {
    await this.log({
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: apiKey.id,
      userId,
      newValue: { id: apiKey.id, name: apiKey.name }, // Don't log the actual key
    });
  }

  /**
   * Log API key revocation
   */
  static async logApiKeyRevoked(apiKeyId: string, userId: string): Promise<void> {
    await this.log({
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: apiKeyId,
      userId,
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });
  }

  /**
   * Log user login
   */
  static async logUserLogin(userId: string, metadata: any): Promise<void> {
    await this.log({
      action: 'user.login',
      entityType: 'user',
      entityId: userId,
      userId,
      metadata,
    });
  }

  /**
   * Log webhook delivery
   */
  static async logWebhookDelivery(
    webhookId: string,
    paymentId: string,
    success: boolean,
    response?: any
  ): Promise<void> {
    await this.log({
      action: success ? 'webhook.delivered' : 'webhook.failed',
      entityType: 'webhook',
      entityId: webhookId,
      paymentId,
      newValue: { success, response },
    });
  }

  /**
   * Get audit logs for a payment
   */
  static async getPaymentAuditLogs(paymentId: string): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get audit logs for a user
   */
  static async getUserAuditLogs(userId: string): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Query audit logs with filters
   */
  static async queryAuditLogs(filters: {
    action?: string;
    entityType?: string;
    entityId?: string;
    userId?: string;
    paymentId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    const where: any = {};

    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.paymentId) where.paymentId = filters.paymentId;

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 100,
        skip: filters.offset || 0,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  /**
   * Archive old audit logs (for compliance)
   * This should be run periodically to move old logs to cold storage
   */
  static async archiveOldLogs(olderThan: Date): Promise<number> {
    // In production, this would move logs to S3 or similar
    // For now, we'll just count them
    const count = await prisma.auditLog.count({
      where: {
        createdAt: {
          lt: olderThan,
        },
      },
    });

    logger.info({ count, olderThan }, 'Audit logs ready for archival');
    return count;
  }

  /**
   * Generate compliance report
   */
  static async generateComplianceReport(startDate: Date, endDate: Date): Promise<any> {
    const [
      totalPayments,
      successfulPayments,
      failedPayments,
      totalApiCalls,
      uniqueUsers,
    ] = await Promise.all([
      prisma.auditLog.count({
        where: {
          action: 'payment.created',
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: 'payment.status_updated',
          newValue: { path: ['status'], equals: 'COMPLETED' },
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: 'payment.status_updated',
          newValue: { path: ['status'], equals: 'FAILED' },
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.auditLog.count({
        where: {
          entityType: 'payment',
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          userId: { not: null },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    return {
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      metrics: {
        totalPayments,
        successfulPayments,
        failedPayments,
        successRate: totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0,
        totalApiCalls,
        uniqueUsers: uniqueUsers.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
