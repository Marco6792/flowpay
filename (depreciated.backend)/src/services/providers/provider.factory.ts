import { PaymentProvider } from './provider.interface.ts';
import { MTNMobileMoneyProvider } from './mtn.provider.ts';
import { OrangeMoneyProvider } from './orange.provider.ts';
import { logger } from '../../utils/logger.ts';

export type ProviderType = 'mtn' | 'orange';

export class ProviderFactory {
  private static providers: Map<ProviderType, PaymentProvider> = new Map();

  static {
    // Initialize providers
    this.providers.set('mtn', new MTNMobileMoneyProvider());
    this.providers.set('orange', new OrangeMoneyProvider());
  }

  static getProvider(type: ProviderType): PaymentProvider | null {
    const provider = this.providers.get(type);

    if (!provider) {
      logger.error({ type }, 'Provider not found');
      return null;
    }

    return provider;
  }

  static detectProvider(phoneNumber: string): ProviderType {
    // Remove @cameroon suffix and any non-digit characters
    const cleaned = phoneNumber.replace(/@cameroon$/, '').replace(/\D/g, '');

    // FlowPay Test Number Patterns (all MTN for testing)
    // 23760 - Request-to-Pay scenarios
    // 23767 - Payment PreApproval scenarios  
    // 23768 - Deposit scenarios
    // 23769 - Transfer scenarios (but should route to Orange for transfer testing)
    // 23770 - Dedicated PreApproval scenarios
    // 23771 - Withdrawal scenarios
    if (/^237(60|67|68|70|71)/.test(cleaned)) {
      return 'mtn';
    }

    // Transfer test scenarios route to Orange for multi-provider testing
    if (/^23769/.test(cleaned)) {
      return 'orange';
    }

    // MTN Cameroon prefixes: 670-679, 680-689
    if (/^237(67[0-9]|68[0-9])/.test(cleaned)) {
      return 'mtn';
    }

    // Orange Cameroon prefixes: 690-699, 655-659
    if (/^237(69[0-9]|65[5-9])/.test(cleaned)) {
      return 'orange';
    }

    // Default to MTN if cannot determine
    logger.warn({ phoneNumber }, 'Could not detect provider, defaulting to MTN');
    return 'mtn';
  }

  static async getAllProvidersHealth(): Promise<Record<ProviderType, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [type, provider] of this.providers) {
      try {
        const status = await provider.healthCheck();
        health[type] = status.healthy;
      } catch (error) {
        logger.error({ type, error }, 'Provider health check failed');
        health[type] = false;
      }
    }

    return health as Record<ProviderType, boolean>;
  }
}
