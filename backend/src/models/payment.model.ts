import { Payment, PaymentStatus, Provider, Prisma } from '@prisma/client';
import { prisma } from '../utils/database.ts';

export interface PaymentCreateInput {
  transactionId: string;
  from: string;
  to: string;
  amount: number;
  currency?: string;
  timestamp: Date;
  provider: Provider;
  apiKeyId: string;
  metadata?: any;
}

export interface PaymentUpdateInput {
  status?: PaymentStatus;
  providerReference?: string;
  metadata?: any;
}

export interface PaymentFilter {
  apiKeyId?: string;
  status?: PaymentStatus;
  provider?: Provider;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: Date;
  endDate?: Date;
}

export class PaymentModel {
  /**
   * Create a new payment
   */
  static async create(data: PaymentCreateInput): Promise<Payment> {
    return prisma.payment.create({
      data: {
        transactionId: data.transactionId,
        from: data.from,
        to: data.to,
        amount: data.amount,
        currency: data.currency || 'XAF',
        timestamp: data.timestamp,
        status: PaymentStatus.PENDING,
        provider: data.provider,
        apiKeyId: data.apiKeyId,
        metadata: data.metadata,
      },
    });
  }

  /**
   * Find payment by ID
   */
  static async findById(id: string): Promise<Payment | null> {
    return prisma.payment.findUnique({
      where: { id },
    });
  }

  /**
   * Find payment by transaction ID
   */
  static async findByTransactionId(transactionId: string): Promise<Payment | null> {
    return prisma.payment.findUnique({
      where: { transactionId },
    });
  }

  /**
   * Update payment
   */
  static async update(id: string, data: PaymentUpdateInput): Promise<Payment> {
    return prisma.payment.update({
      where: { id },
      data,
    });
  }

  /**
   * Update payment status
   */
  static async updateStatus(id: string, status: PaymentStatus): Promise<Payment> {
    return prisma.payment.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * List payments with filters
   */
  static async list(filter: PaymentFilter, limit = 100, offset = 0): Promise<Payment[]> {
    const where: Prisma.PaymentWhereInput = {};

    if (filter.apiKeyId) where.apiKeyId = filter.apiKeyId;
    if (filter.status) where.status = filter.status;
    if (filter.provider) where.provider = filter.provider;
    if (filter.from) where.from = filter.from;
    if (filter.to) where.to = filter.to;

    if (filter.minAmount || filter.maxAmount) {
      where.amount = {};
      if (filter.minAmount) where.amount.gte = filter.minAmount;
      if (filter.maxAmount) where.amount.lte = filter.maxAmount;
    }

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    return prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Count payments with filters
   */
  static async count(filter: PaymentFilter): Promise<number> {
    const where: Prisma.PaymentWhereInput = {};

    if (filter.apiKeyId) where.apiKeyId = filter.apiKeyId;
    if (filter.status) where.status = filter.status;
    if (filter.provider) where.provider = filter.provider;

    return prisma.payment.count({ where });
  }

  /**
   * Get payment statistics
   */
  static async getStats(apiKeyId?: string, period?: { start: Date; end: Date }): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    totalAmount: number;
    averageAmount: number;
  }> {
    const where: Prisma.PaymentWhereInput = {};
    if (apiKeyId) where.apiKeyId = apiKeyId;
    if (period) {
      where.createdAt = {
        gte: period.start,
        lte: period.end,
      };
    }

    const [total, completed, failed, pending, amounts] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: PaymentStatus.COMPLETED } }),
      prisma.payment.count({ where: { ...where, status: PaymentStatus.FAILED } }),
      prisma.payment.count({ where: { ...where, status: PaymentStatus.PENDING } }),
      prisma.payment.aggregate({
        where: { ...where, status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
    ]);

    return {
      total,
      completed,
      failed,
      pending,
      totalAmount: amounts._sum.amount || 0,
      averageAmount: amounts._avg.amount || 0,
    };
  }

  /**
   * Delete payment (soft delete by updating status)
   */
  static async delete(id: string): Promise<Payment> {
    return prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.CANCELLED },
    });
  }
}
