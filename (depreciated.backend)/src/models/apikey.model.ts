import { ApiKey, Prisma } from '@prisma/client';
import { prisma } from '../utils/database.ts';
import crypto from 'crypto';

export interface ApiKeyCreateInput {
  name: string;
  userId: string;
  permissions?: string[];
  expiresAt?: Date;
}

export interface ApiKeyUpdateInput {
  name?: string;
  isActive?: boolean;
  permissions?: string[];
  expiresAt?: Date;
}

export interface ApiKeyWithStats extends ApiKey {
  _count?: {
    payments: number;
  };
}

export class ApiKeyModel {
  /**
   * Generate a secure API key
   */
  private static generateKey(): string {
    const prefix = 'pk_';
    const randomBytes = crypto.randomBytes(32);
    const key = randomBytes.toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 32);
    return `${prefix}${key}`;
  }

  /**
   * Create a new API key
   */
  static async create(data: ApiKeyCreateInput): Promise<ApiKey> {
    const key = this.generateKey();

    return prisma.apiKey.create({
      data: {
        key,
        name: data.name,
        userId: data.userId,
        isActive: true,
      },
    });
  }

  /**
   * Find API key by ID
   */
  static async findById(id: string): Promise<ApiKey | null> {
    return prisma.apiKey.findUnique({
      where: { id },
    });
  }

  /**
   * Find API key by key value
   */
  static async findByKey(key: string): Promise<ApiKey | null> {
    return prisma.apiKey.findUnique({
      where: { key },
    });
  }

  /**
   * Find active API key by key value
   */
  static async findActiveByKey(key: string): Promise<ApiKey | null> {
    return prisma.apiKey.findFirst({
      where: {
        key,
        isActive: true,
      },
    });
  }

  /**
   * Update API key
   */
  static async update(id: string, data: ApiKeyUpdateInput): Promise<ApiKey> {
    return prisma.apiKey.update({
      where: { id },
      data,
    });
  }

  /**
   * List API keys for a user
   */
  static async listByUser(userId: string, includeInactive = false): Promise<ApiKeyWithStats[]> {
    const where: Prisma.ApiKeyWhereInput = { userId };
    if (!includeInactive) {
      where.isActive = true;
    }

    return prisma.apiKey.findMany({
      where,
      include: {
        _count: {
          select: { payments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke API key
   */
  static async revoke(id: string): Promise<ApiKey> {
    return prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Delete API key (hard delete)
   */
  static async delete(id: string): Promise<ApiKey> {
    return prisma.apiKey.delete({
      where: { id },
    });
  }

  /**
   * Check if API key has permission
   */
  static async hasPermission(apiKey: ApiKey, _permission: string): Promise<boolean> {
    // For now, all active API keys have all permissions
    return apiKey.isActive;
  }

  /**
   * Get API key usage statistics
   */
  static async getStats(id: string, period?: { start: Date; end: Date }): Promise<{
    totalRequests: number;
    successfulPayments: number;
    failedPayments: number;
    totalVolume: number;
    lastUsed: Date | null;
  }> {
    const where: Prisma.PaymentWhereInput = { apiKeyId: id };
    if (period) {
      where.createdAt = {
        gte: period.start,
        lte: period.end,
      };
    }

    const [totalRequests, successfulPayments, failedPayments, volumeData, lastPayment] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.payment.count({ where: { ...where, status: 'FAILED' } }),
      prisma.payment.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.payment.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      totalRequests,
      successfulPayments,
      failedPayments,
      totalVolume: volumeData._sum.amount || 0,
      lastUsed: lastPayment?.createdAt || null,
    };
  }

  /**
   * Rotate API key (create new, deactivate old)
   */
  static async rotate(id: string): Promise<ApiKey> {
    const oldKey = await this.findById(id);
    if (!oldKey) {
      throw new Error('API key not found');
    }

    // Create new key with same settings
    const newKey = await this.create({
      name: `${oldKey.name} (rotated)`,
      userId: oldKey.userId,
    });

    // Deactivate old key
    await this.revoke(id);

    return newKey;
  }
}
