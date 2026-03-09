import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

// These types will be available from @prisma/client after migration
interface FeeStructure {
  id: string;
  name: string;
  description: string | null;
  percentage: number;
  minFee: number;
  maxFee: number;
  fixedFee: number | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface MerchantFee {
  id: string;
  userId: string;
  feeStructureId: string;
  customPercentage: number | null;
  customMinFee: number | null;
  customMaxFee: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  feeStructure?: FeeStructure;
}

interface FeeVolumeTier {
  id: string;
  name: string;
  minVolume: number;
  maxVolume: number | null;
  percentage: number;
  minFee: number;
  maxFee: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeCalculation {
  fee: number;
  commission: number;
  netAmount: number;
  appliedStructure: string;
  percentage: number;
}

export class FeeService {
  /**
   * Get the active fee structure for a merchant
   */
  static async getMerchantFeeStructure(userId: string): Promise<FeeStructure | null> {
    try {
      // First, check if merchant has a specific fee assignment
      const merchantFee = await (prisma as any).merchantFee?.findFirst({
        where: {
          userId,
          effectiveTo: null, // Currently active
          feeStructure: {
            isActive: true,
          },
        },
        include: {
          feeStructure: true,
        },
      });

      if (merchantFee) {
        // If merchant has custom overrides, apply them
        const structure = merchantFee.feeStructure;
        return {
          ...structure,
          percentage: merchantFee.customPercentage ?? structure.percentage,
          minFee: merchantFee.customMinFee ?? structure.minFee,
          maxFee: merchantFee.customMaxFee ?? structure.maxFee,
        };
      }

      // Otherwise, get the default fee structure
      const defaultStructure = await (prisma as any).feeStructure?.findFirst?.({
        where: {
          isDefault: true,
          isActive: true,
        },
      });

      return defaultStructure;
    } catch (error) {
      logger.error({ error, userId }, 'Error getting merchant fee structure');
      return null;
    }
  }

  /**
   * Calculate fee for a transaction
   */
  static async calculateFee(amount: number, userId: string): Promise<FeeCalculation> {
    const structure = await this.getMerchantFeeStructure(userId);

    if (!structure) {
      // If no fee structure found, return zero fees (admin needs to set it up)
      logger.warn({ userId }, 'No fee structure found for merchant, using zero fees');
      return {
        fee: 0,
        commission: 0,
        netAmount: amount,
        appliedStructure: 'NONE',
        percentage: 0,
      };
    }

    // Calculate percentage-based fee
    let fee = Math.round(amount * (structure.percentage / 100));

    // Apply min/max bounds
    fee = Math.max(structure.minFee, Math.min(fee, structure.maxFee));

    // Add fixed fee if applicable
    if (structure.fixedFee) {
      fee += structure.fixedFee;
    }

    const commission = fee; // Commission equals fee for now
    const netAmount = amount - fee;

    return {
      fee,
      commission,
      netAmount,
      appliedStructure: structure.name,
      percentage: structure.percentage,
    };
  }

  /**
   * Get volume-based tier for a merchant
   */
  static async getVolumeTier(userId: string, monthlyVolume: number): Promise<FeeVolumeTier | null> {
    try {
      const tier = await (prisma as any).feeVolumeTier?.findFirst?.({
        where: {
          isActive: true,
          minVolume: { lte: monthlyVolume },
          OR: [
            { maxVolume: null },
            { maxVolume: { gte: monthlyVolume } },
          ],
        },
        orderBy: {
          minVolume: 'desc',
        },
      });

      return tier;
    } catch (error) {
      logger.error({ error, userId, monthlyVolume }, 'Error getting volume tier');
      return null;
    }
  }

  /**
   * Create a new fee structure (admin only)
   */
  static async createFeeStructure(data: {
    name: string;
    description?: string;
    percentage: number;
    minFee: number;
    maxFee: number;
    fixedFee?: number;
    isDefault?: boolean;
    createdBy?: string;
  }): Promise<FeeStructure> {
    // If setting as default, unset other defaults
    if (data.isDefault) {
      await (prisma as any).feeStructure?.updateMany?.({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    return (prisma as any).feeStructure?.create?.({
      data,
    });
  }

  /**
   * Assign fee structure to a merchant (admin only)
   */
  static async assignMerchantFee(data: {
    userId: string;
    feeStructureId: string;
    customPercentage?: number;
    customMinFee?: number;
    customMaxFee?: number;
    notes?: string;
    createdBy?: string;
  }): Promise<MerchantFee> {
    // End any existing active fee for this merchant
    await (prisma as any).merchantFee?.updateMany?.({
      where: {
        userId: data.userId,
        effectiveTo: null,
      },
      data: {
        effectiveTo: new Date(),
      },
    });

    // Create new fee assignment
    return (prisma as any).merchantFee?.create?.({
      data: {
        ...data,
        effectiveFrom: new Date(),
      },
    });
  }

  /**
   * Update fee structure (admin only)
   */
  static async updateFeeStructure(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      percentage: number;
      minFee: number;
      maxFee: number;
      fixedFee: number;
      isDefault: boolean;
      isActive: boolean;
    }>
  ): Promise<FeeStructure> {
    // If setting as default, unset other defaults
    if (data.isDefault) {
      await (prisma as any).feeStructure?.updateMany?.({
        where: {
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    return (prisma as any).feeStructure?.update?.({
      where: { id },
      data,
    });
  }

  /**
   * List all fee structures (admin only)
   */
  static async listFeeStructures(includeInactive = false): Promise<FeeStructure[]> {
    return (prisma as any).feeStructure?.findMany?.({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
    });
  }

  /**
   * Get merchant fee history
   */
  static async getMerchantFeeHistory(userId: string): Promise<MerchantFee[]> {
    return (prisma as any).merchantFee?.findMany?.({
      where: { userId },
      include: { feeStructure: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Calculate monthly volume for a merchant
   */
  static async calculateMonthlyVolume(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await prisma.payment.aggregate({
      where: {
        userId,
        createdAt: { gte: startOfMonth },
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
    });

    return result._sum.amount || 0;
  }
}
