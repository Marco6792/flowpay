import { PaymentProvider } from './provider.interface';
import { MTNMobileMoneyProvider } from './mtn.provider';
import { OrangeMoneyProvider } from './orange.provider';
import { logger } from '../../utils/logger';

export type ProviderType = 'mtn' | 'orange';
export type ProviderMode = 'SANDBOX' | 'LIVE';

export class ProviderFactory {
  private static sandboxProviders: Map<ProviderType, PaymentProvider> = new Map();
  private static liveProviders: Map<ProviderType, PaymentProvider> = new Map();

  // Legacy alias for backward compatibility
  private static providers: Map<ProviderType, PaymentProvider>;

  static {
    // Initialize sandbox providers (test environment)
    this.sandboxProviders.set('mtn', new MTNMobileMoneyProvider('sandbox'));
    this.sandboxProviders.set('orange', new OrangeMoneyProvider('sandbox'));

    // Initialize live providers (production environment)
    this.liveProviders.set('mtn', new MTNMobileMoneyProvider('production'));
    this.liveProviders.set('orange', new OrangeMoneyProvider('production'));

    // Default to sandbox for backward compatibility
    this.providers = this.sandboxProviders;
  }

  static getProvider(type: ProviderType, mode: ProviderMode = 'SANDBOX'): PaymentProvider | null {
    const providers = mode === 'LIVE' ? this.liveProviders : this.sandboxProviders;
    const provider = providers.get(type);

    if (!provider) {
      logger.error({ type, mode }, 'Provider not found');
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

  static async getAllProvidersHealth(mode: ProviderMode = 'SANDBOX'): Promise<Record<ProviderType, boolean>> {
    const health: Record<string, boolean> = {};
    const providers = mode === 'LIVE' ? this.liveProviders : this.sandboxProviders;

    for (const [type, provider] of providers) {
      try {
        const status = await provider.healthCheck();
        health[type] = status.healthy;
      } catch (error) {
        logger.error({ type, mode, error }, 'Provider health check failed');
        health[type] = false;
      }
    }

    return health as Record<ProviderType, boolean>;
  }
}
