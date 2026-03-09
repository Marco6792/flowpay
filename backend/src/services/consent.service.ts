import { logger } from '../utils/logger.ts';
import { ProviderFactory } from './providers/provider.factory.ts';
import { BCAuthorizeRequest, OAuth2TokenRequest } from './providers/provider.interface.ts';

export interface CreateConsentRequest {
  customerId: string; // Customer's MSISDN
  scope: string; // e.g., 'profile transfer balance'
  accessType: 'online' | 'offline';
  consentValidIn?: number; // seconds
  businessId: string; // Business requesting consent
  description?: string; // Human-readable description of what consent is for
  provider?: string;
  metadata?: Record<string, any>;
}

export interface ConsentServiceResponse {
  success: boolean;
  authReqId?: string;
  interval?: number;
  expiresIn?: number;
  pollUrl?: string; // URL to poll for token
  message?: string;
}

export interface TokenFromConsentRequest {
  authReqId: string;
  provider?: string;
}

export interface TokenResponse {
  success: boolean;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  message?: string;
}

export interface UserInfoFromTokenRequest {
  accessToken: string;
  provider?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
  provider?: string;
}

export interface RevokeConsentRequest {
  accessToken: string;
  provider?: string;
}

export interface BasicUserInfoRequest {
  msisdn: string;
  provider?: string;
}

export class ConsentService {
  private getProviderInstance(providerName: string) {
    const normalizedProvider = providerName.toLowerCase() as 'mtn' | 'orange';
    const provider = ProviderFactory.getProvider(normalizedProvider);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    return provider;
  }

  /**
   * Initiate consent authorization flow
   * This starts the process where a customer authorizes a business to access their account
   */
  async createConsent(data: CreateConsentRequest): Promise<ConsentServiceResponse> {
    try {
      const provider = this.getProviderInstance(data.provider || 'MTN');

      // Format login hint as required by MTN: ID:{msisdn}/MSISDN
      const loginHint = `ID:${data.customerId}/MSISDN`;

      const bcAuthorizeRequest: BCAuthorizeRequest = {
        scope: data.scope,
        loginHint,
        accessType: data.accessType,
        consentValidIn: data.consentValidIn || 3600, // Default 1 hour
        callbackUrl: process.env.CONSENT_CALLBACK_URL,
        scopeInstruction: data.description,
      };

      logger.info({
        customerId: data.customerId,
        businessId: data.businessId,
        scope: data.scope,
        accessType: data.accessType,
        provider: data.provider || 'MTN',
      }, 'Creating consent authorization');

      const result = await provider.bcAuthorize(bcAuthorizeRequest);

      if (result.success) {
        // Store consent request in database for tracking
        // TODO: Implement consent storage once database migration is applied

        logger.info({
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          customerId: data.customerId,
          businessId: data.businessId,
        }, 'Consent authorization created successfully');

        return {
          success: true,
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          pollUrl: `/api/v1/consent/token/${result.authReqId}`,
          message: 'Consent authorization initiated. Customer will receive SMS to approve.',
        };
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        consentData: data,
      }, 'Failed to create consent');

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Exchange authorization for access token
   * Called after customer approves the consent via SMS
   */
  async getTokenFromConsent(data: TokenFromConsentRequest): Promise<TokenResponse> {
    try {
      const provider = this.getProviderInstance(data.provider || 'MTN');

      const tokenRequest: OAuth2TokenRequest = {
        grantType: 'urn:openid:params:grant-type:ciba',
        authReqId: data.authReqId,
      };

      logger.info({
        authReqId: data.authReqId,
        provider: data.provider || 'MTN',
      }, 'Getting access token from consent');

      const result = await provider.createOAuth2Token(tokenRequest);

      if (result.success) {
        // TODO: Store token in database for future use

        logger.info({
          authReqId: data.authReqId,
          accessTokenLength: result.accessToken?.length,
          hasRefreshToken: !!result.refreshToken,
        }, 'Access token obtained successfully');

        return {
          success: true,
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          refreshToken: result.refreshToken,
          refreshExpiresIn: result.refreshExpiresIn,
        };
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        authReqId: data.authReqId,
      }, 'Failed to get token from consent');

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Get user information using OAuth2 access token
   */
  async getUserInfoFromToken(data: UserInfoFromTokenRequest) {
    try {
      const provider = this.getProviderInstance(data.provider || 'MTN');

      logger.info({
        accessTokenLength: data.accessToken.length,
        provider: data.provider || 'MTN',
      }, 'Getting user info from OAuth2 token');

      const result = await provider.getOAuth2UserInfo(data.accessToken);

      if (result.success) {
        logger.info({
          sub: result.userInfo?.sub,
          hasName: !!result.userInfo?.name,
        }, 'User info retrieved successfully');

        return result;
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        accessTokenLength: data.accessToken.length,
      }, 'Failed to get user info from token');

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Refresh OAuth2 token using refresh token
   */
  async refreshOAuth2Token(data: RefreshTokenRequest): Promise<TokenResponse> {
    try {
      const provider = this.getProviderInstance(data.provider || 'MTN');

      logger.info({
        refreshTokenLength: data.refreshToken.length,
        provider: data.provider || 'MTN',
      }, 'Refreshing OAuth2 token');

      const result = await provider.refreshOAuth2Token(data.refreshToken);

      if (result.success) {
        logger.info({
          accessTokenLength: result.accessToken?.length,
          hasNewRefreshToken: !!result.refreshToken,
        }, 'OAuth2 token refreshed successfully');

        return {
          success: true,
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          refreshToken: result.refreshToken,
          refreshExpiresIn: result.refreshExpiresIn,
        };
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        refreshTokenLength: data.refreshToken.length,
      }, 'Failed to refresh OAuth2 token');

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Revoke OAuth2 consent
   */
  async revokeConsent(data: RevokeConsentRequest) {
    try {
      const provider = this.getProviderInstance(data.provider || 'MTN');

      logger.info({
        accessTokenLength: data.accessToken.length,
        provider: data.provider || 'MTN',
      }, 'Revoking OAuth2 consent');

      const result = await provider.revokeOAuth2Consent(data.accessToken);

      if (result.success) {
        logger.info('OAuth2 consent revoked successfully');

        // TODO: Clean up any stored consent data in database

        return result;
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        accessTokenLength: data.accessToken.length,
      }, 'Failed to revoke OAuth2 consent');

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Get basic user info without consent
   */
  async getBasicUserInfo(data: BasicUserInfoRequest) {
    try {
      const provider = this.getProviderInstance(data.provider || 'MTN');

      logger.info({
        msisdn: data.msisdn,
        provider: data.provider || 'MTN',
      }, 'Getting basic user info');

      const result = await provider.getBasicUserInfo(data.msisdn);

      if (result.success) {
        logger.info({
          msisdn: data.msisdn,
          hasUserInfo: !!result.userInfo,
        }, 'Basic user info retrieved successfully');

        return result;
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        msisdn: data.msisdn,
      }, 'Failed to get basic user info');

      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Business Use Cases for Consent Management
   */

  /**
   * Create subscription billing consent
   * Example: Monthly subscription for streaming service
   */
  async createSubscriptionConsent(customerId: string, businessId: string, amount: number, frequency: 'monthly' | 'weekly' | 'daily') {
    return await this.createConsent({
      customerId,
      businessId,
      scope: 'transfer balance',
      accessType: 'offline', // For recurring payments
      consentValidIn: 30 * 24 * 3600, // 30 days
      description: `Authorize ${businessId} to deduct ${amount} XAF ${frequency} for subscription`,
      metadata: {
        type: 'subscription',
        amount,
        frequency,
        businessId,
      },
    });
  }

  /**
   * Create bill payment consent
   * Example: Utility company auto-pay
   */
  async createBillPaymentConsent(customerId: string, businessId: string, maxAmount: number) {
    return await this.createConsent({
      customerId,
      businessId,
      scope: 'transfer balance',
      accessType: 'offline',
      consentValidIn: 90 * 24 * 3600, // 90 days
      description: `Authorize ${businessId} to deduct up to ${maxAmount} XAF for bill payments`,
      metadata: {
        type: 'bill_payment',
        maxAmount,
        businessId,
      },
    });
  }

  /**
   * Create account access consent
   * Example: Financial app accessing account balance
   */
  async createAccountAccessConsent(customerId: string, businessId: string) {
    return await this.createConsent({
      customerId,
      businessId,
      scope: 'profile balance',
      accessType: 'online',
      consentValidIn: 24 * 3600, // 24 hours
      description: `Authorize ${businessId} to view your account balance and profile`,
      metadata: {
        type: 'account_access',
        businessId,
      },
    });
  }
}

export const consentService = new ConsentService();
