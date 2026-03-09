import { randomUUID } from 'crypto';
import { MTNMobileMoneyProvider } from './providers/mtn.provider';
import { logger } from '../utils/logger';

export interface CreateApiUserResult {
  success: boolean;
  referenceId: string;
  message?: string;
}

export interface CreateApiKeyResult {
  success: boolean;
  referenceId: string;
  apiKey?: string;
  message?: string;
  notFound?: boolean;
}

export interface GetApiUserResult {
  success: boolean;
  referenceId: string;
  providerCallbackHost?: string;
  targetEnvironment?: string;
  message?: string;
}

/**
 * Sandbox Provisioning Service
 *
 * Implements the MTN Sandbox Provisioning API, which allows developers to create
 * API users and API keys in the sandbox environment without using the MTN portal.
 *
 * Reference: sandbox-provisioning-api.json (OpenAPI 3.0.1)
 */
export class SandboxService {
  private provider: MTNMobileMoneyProvider;

  constructor() {
    this.provider = new MTNMobileMoneyProvider('sandbox');
  }

  /**
   * Create a new sandbox API user.
   *
   * Corresponds to: POST /v1_0/apiuser
   *
   * @param providerCallbackHost - The callback host for the API user (e.g. "your-domain.com")
   * @param referenceId - Optional UUID for the new API user. A new UUID is generated if omitted.
   */
  async createApiUser(
    providerCallbackHost: string,
    referenceId?: string
  ): Promise<CreateApiUserResult> {
    const userId = referenceId || randomUUID();

    try {
      logger.info({ referenceId: userId, providerCallbackHost }, 'Creating MTN sandbox API user');

      const result = await this.provider.createSandboxApiUser(userId, providerCallbackHost);

      if (result.success) {
        return { success: true, referenceId: userId };
      }

      return { success: false, referenceId: userId, message: result.message };
    } catch (error: any) {
      logger.error({ error: error.message, referenceId: userId }, 'Failed to create sandbox API user');
      return {
        success: false,
        referenceId: userId,
        message: error.message || 'An unexpected error occurred',
      };
    }
  }

  /**
   * Create an API key for an existing sandbox API user.
   *
   * Corresponds to: POST /v1_0/apiuser/{X-Reference-Id}/apikey
   *
   * @param referenceId - UUID of the existing API user
   */
  async createApiKey(referenceId: string): Promise<CreateApiKeyResult> {
    try {
      logger.info({ referenceId }, 'Creating MTN sandbox API key');

      const result = await this.provider.createSandboxApiKey(referenceId);

      if (result.success) {
        return { success: true, referenceId, apiKey: result.apiKey };
      }

      return { success: false, referenceId, message: result.message, notFound: result.notFound };
    } catch (error: any) {
      logger.error({ error: error.message, referenceId }, 'Failed to create sandbox API key');
      return {
        success: false,
        referenceId,
        message: error.message || 'An unexpected error occurred',
      };
    }
  }

  /**
   * Get details of an existing sandbox API user.
   *
   * Corresponds to: GET /v1_0/apiuser/{X-Reference-Id}
   *
   * @param referenceId - UUID of the API user to retrieve
   */
  async getApiUser(referenceId: string): Promise<GetApiUserResult> {
    try {
      logger.info({ referenceId }, 'Fetching MTN sandbox API user details');

      const data = await this.provider.getSandboxApiUser(referenceId);

      if (data === null) {
        return { success: false, referenceId, message: 'API user not found' };
      }

      return {
        success: true,
        referenceId,
        providerCallbackHost: data.providerCallbackHost,
        targetEnvironment: data.targetEnvironment,
      };
    } catch (error: any) {
      logger.error({ error: error.message, referenceId }, 'Failed to get sandbox API user');
      return {
        success: false,
        referenceId,
        message: error.message || 'An unexpected error occurred',
      };
    }
  }
}
