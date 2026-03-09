/**
 * Fee configuration for FlowPay revenue model
 */

export interface FeeStructure {
  percentage: number;  // Percentage fee (e.g., 1.5 for 1.5%)
  minFee: number;     // Minimum fee amount
  maxFee: number;     // Maximum fee amount
  fixedFee?: number;  // Optional fixed fee component
}

export interface MerchantFeeConfig {
  default: FeeStructure;
  volume?: {
    // Volume-based pricing tiers
    tiers: Array<{
      minVolume: number;    // Monthly volume threshold
      structure: FeeStructure;
    }>;
  };
  custom?: Map<string, FeeStructure>; // Custom pricing for specific merchants
}

// Default fee configuration
export const defaultFeeConfig: MerchantFeeConfig = {
  default: {
    percentage: 1.5,   // 1.5% transaction fee
    minFee: 50,       // Minimum 50 XAF
    maxFee: 5000,     // Maximum 5000 XAF
  },
  volume: {
    tiers: [
      {
        minVolume: 0,
        structure: {
          percentage: 1.5,
          minFee: 50,
          maxFee: 5000,
        },
      },
      {
        minVolume: 1000000, // Over 1M XAF monthly
        structure: {
          percentage: 1.2,
          minFee: 40,
          maxFee: 4000,
        },
      },
      {
        minVolume: 5000000, // Over 5M XAF monthly
        structure: {
          percentage: 1.0,
          minFee: 30,
          maxFee: 3000,
        },
      },
      {
        minVolume: 10000000, // Over 10M XAF monthly
        structure: {
          percentage: 0.8,
          minFee: 25,
          maxFee: 2500,
        },
      },
    ],
  },
};

/**
 * Calculate fee for a transaction
 */
export function calculateFee(
  amount: number,
  structure: FeeStructure = defaultFeeConfig.default
): {
  fee: number;
  commission: number;
  netAmount: number;
} {
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
  };
}

/**
 * Get fee structure for a merchant based on volume
 */
export async function getMerchantFeeStructure(
  userId: string,
  monthlyVolume?: number
): Promise<FeeStructure> {
  // Check for custom merchant pricing
  // This could be loaded from database in production
  const customFees = defaultFeeConfig.custom?.get(userId);
  if (customFees) {
    return customFees;
  }
  
  // Apply volume-based pricing if volume is provided
  if (monthlyVolume && defaultFeeConfig.volume) {
    const tiers = defaultFeeConfig.volume.tiers.sort((a, b) => b.minVolume - a.minVolume);
    
    for (const tier of tiers) {
      if (monthlyVolume >= tier.minVolume) {
        return tier.structure;
      }
    }
  }
  
  return defaultFeeConfig.default;
}

/**
 * Revenue breakdown for FlowPay
 */
export interface RevenueBreakdown {
  grossAmount: number;       // Total transaction amount
  flowpayFee: number;        // FlowPay's fee (revenue)
  providerFee: number;       // Provider's fee (MTN/Orange)
  netToMerchant: number;     // Amount merchant receives
  netToFlowpay: number;      // FlowPay's profit after provider fees
}

/**
 * Calculate complete revenue breakdown
 */
export function calculateRevenueBreakdown(
  amount: number,
  structure: FeeStructure = defaultFeeConfig.default,
  providerFeePercentage: number = 0.5 // Assume 0.5% provider fee
): RevenueBreakdown {
  const { fee: flowpayFee, netAmount } = calculateFee(amount, structure);
  const providerFee = Math.round(amount * (providerFeePercentage / 100));
  
  return {
    grossAmount: amount,
    flowpayFee,
    providerFee,
    netToMerchant: netAmount,
    netToFlowpay: flowpayFee - providerFee,
  };
}