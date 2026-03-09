import { FastifyRequest, FastifyReply } from 'fastify';
import { consentService } from '../services/consent.service.ts';
import { logger } from '../utils/logger.ts';

interface CreateConsentBody {
  customerId: string;
  scope: string;
  accessType: 'online' | 'offline';
  consentValidIn?: number | string;
  businessId: string;
  description?: string;
  provider?: string;
  metadata?: Record<string, any> | string;
}

interface SubscriptionConsentBody {
  customerId: string;
  businessId: string;
  amount: number;
  frequency: 'monthly' | 'weekly' | 'daily';
  provider?: string;
}

interface BillPaymentConsentBody {
  customerId: string;
  businessId: string;
  maxAmount: number;
  provider?: string;
}

interface AccountAccessConsentBody {
  customerId: string;
  businessId: string;
  provider?: string;
}

interface GetTokenParams {
  authReqId: string;
}

interface GetUserInfoBody {
  accessToken: string;
  provider?: string;
}

interface RefreshTokenBody {
  refreshToken: string;
  provider?: string;
}

interface RevokeConsentBody {
  accessToken: string;
  provider?: string;
}

interface BasicUserInfoParams {
  msisdn: string;
}

export class ConsentController {
  /**
   * Create general consent authorization
   */
  async createConsent(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Debug logging
      console.log('🔍 Request body received:', JSON.stringify(request.body, null, 2));
      console.log('🔍 Request content-type:', request.headers['content-type']);

      const consentData = request.body as CreateConsentBody;

      // Validate required fields
      if (!consentData.customerId || !consentData.scope || !consentData.accessType || !consentData.businessId) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: customerId, scope, accessType, businessId',
        });
      }

      // Handle form-encoded data conversion
      let metadata: Record<string, any> | undefined = consentData.metadata as Record<string, any> | undefined;
      if (typeof consentData.metadata === 'string') {
        try {
          metadata = JSON.parse(consentData.metadata);
        } catch {
          metadata = {};
        }
      }

      let consentValidIn = consentData.consentValidIn;
      if (typeof consentValidIn === 'string') {
        consentValidIn = parseInt(consentValidIn, 10) || undefined;
      }

      const result = await consentService.createConsent({
        customerId: consentData.customerId,
        scope: consentData.scope,
        accessType: consentData.accessType,
        consentValidIn,
        businessId: consentData.businessId,
        description: consentData.description,
        provider: consentData.provider || 'MTN',
        metadata,
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          pollUrl: result.pollUrl,
          message: result.message,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Consent creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Create subscription billing consent
   */
  async createSubscriptionConsent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = request.body as SubscriptionConsentBody;

      if (!data.customerId || !data.businessId || !data.amount || !data.frequency) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: customerId, businessId, amount, frequency',
        });
      }

      if (data.amount <= 0) {
        return reply.status(400).send({
          success: false,
          error: 'Amount must be greater than 0',
        });
      }

      const result = await consentService.createSubscriptionConsent(
        data.customerId,
        data.businessId,
        data.amount,
        data.frequency
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          pollUrl: result.pollUrl,
          message: result.message,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Subscription consent creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Create bill payment consent
   */
  async createBillPaymentConsent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = request.body as BillPaymentConsentBody;

      if (!data.customerId || !data.businessId || !data.maxAmount) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: customerId, businessId, maxAmount',
        });
      }

      if (data.maxAmount <= 0) {
        return reply.status(400).send({
          success: false,
          error: 'maxAmount must be greater than 0',
        });
      }

      const result = await consentService.createBillPaymentConsent(
        data.customerId,
        data.businessId,
        data.maxAmount
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          pollUrl: result.pollUrl,
          message: result.message,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Bill payment consent creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Create account access consent
   */
  async createAccountAccessConsent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = request.body as AccountAccessConsentBody;

      if (!data.customerId || !data.businessId) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: customerId, businessId',
        });
      }

      const result = await consentService.createAccountAccessConsent(
        data.customerId,
        data.businessId
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.status(201).send({
        success: true,
        data: {
          authReqId: result.authReqId,
          interval: result.interval,
          expiresIn: result.expiresIn,
          pollUrl: result.pollUrl,
          message: result.message,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Account access consent creation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get access token from authorization
   */
  async getTokenFromConsent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { authReqId } = request.params as GetTokenParams;
      const { provider = 'MTN' } = request.query as { provider?: string };

      const result = await consentService.getTokenFromConsent({
        authReqId,
        provider,
      });

      if (!result.success) {
        // If consent not yet approved, return appropriate status
        if (result.message?.includes('pending') || result.message?.includes('waiting')) {
          return reply.status(202).send({
            success: false,
            error: 'Consent approval pending',
            message: 'Customer has not yet approved the consent. Please try again later.',
          });
        }

        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.send({
        success: true,
        data: {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          refreshToken: result.refreshToken,
          refreshExpiresIn: result.refreshExpiresIn,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Token retrieval failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get user info using OAuth2 token
   */
  async getUserInfoFromToken(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = request.body as GetUserInfoBody;

      if (!data.accessToken) {
        return reply.status(400).send({
          success: false,
          error: 'accessToken is required',
        });
      }

      const result = await consentService.getUserInfoFromToken({
        accessToken: data.accessToken,
        provider: data.provider || 'MTN',
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.send({
        success: true,
        data: {
          userInfo: 'userInfo' in result ? result.userInfo : undefined,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'User info retrieval failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Refresh OAuth2 token
   */
  async refreshToken(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = request.body as RefreshTokenBody;

      if (!data.refreshToken) {
        return reply.status(400).send({
          success: false,
          error: 'refreshToken is required',
        });
      }

      const result = await consentService.refreshOAuth2Token({
        refreshToken: data.refreshToken,
        provider: data.provider || 'MTN',
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.send({
        success: true,
        data: {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          refreshToken: result.refreshToken,
          refreshExpiresIn: result.refreshExpiresIn,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Token refresh failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Revoke OAuth2 consent
   */
  async revokeConsent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = request.body as RevokeConsentBody;

      if (!data.accessToken) {
        return reply.status(400).send({
          success: false,
          error: 'accessToken is required',
        });
      }

      const result = await consentService.revokeConsent({
        accessToken: data.accessToken,
        provider: data.provider || 'MTN',
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.send({
        success: true,
        message: 'Consent revoked successfully',
      });
    } catch (error: any) {
      logger.error({ error }, 'Consent revocation failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Get basic user info without consent
   */
  async getBasicUserInfo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { msisdn } = request.params as BasicUserInfoParams;
      const { provider = 'MTN' } = request.query as { provider?: string };

      if (!msisdn) {
        return reply.status(400).send({
          success: false,
          error: 'msisdn is required',
        });
      }

      const result = await consentService.getBasicUserInfo({
        msisdn,
        provider,
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.message,
        });
      }

      return reply.send({
        success: true,
        data: {
          userInfo: 'userInfo' in result ? result.userInfo : undefined,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Basic user info retrieval failed');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  }
}

export const consentController = new ConsentController();
