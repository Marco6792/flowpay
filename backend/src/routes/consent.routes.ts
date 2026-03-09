import { FastifyInstance } from 'fastify';
import { consentController } from '../controllers/consent.controller.ts';

export async function consentRoutes(app: FastifyInstance) {
  // General consent management
  app.post('/consent', {
    schema: {
      body: {
        type: 'object',
        required: ['customerId', 'scope', 'accessType', 'businessId'],
        properties: {
          customerId: { type: 'string', description: 'Customer MSISDN (phone number)' },
          scope: { type: 'string', description: 'Requested permissions (e.g., "profile transfer balance")' },
          accessType: { type: 'string', enum: ['online', 'offline'], description: 'online = one-time, offline = recurring' },
          consentValidIn: { type: ['number', 'string'], description: 'Consent validity in seconds' },
          businessId: { type: 'string', description: 'Business requesting consent' },
          description: { type: 'string', description: 'Human-readable consent description' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
          metadata: { type: ['object', 'string'], description: 'Additional consent metadata' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                authReqId: { type: 'string' },
                interval: { type: 'number' },
                expiresIn: { type: 'number' },
                pollUrl: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, consentController.createConsent.bind(consentController));

  // Subscription billing consent
  app.post('/consent/subscription', {
    schema: {
      body: {
        type: 'object',
        required: ['customerId', 'businessId', 'amount', 'frequency'],
        properties: {
          customerId: { type: 'string', description: 'Customer MSISDN' },
          businessId: { type: 'string', description: 'Business name/ID' },
          amount: { type: 'number', minimum: 1, description: 'Subscription amount in XAF' },
          frequency: { type: 'string', enum: ['monthly', 'weekly', 'daily'], description: 'Billing frequency' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
    },
  }, consentController.createSubscriptionConsent.bind(consentController));

  // Bill payment consent
  app.post('/consent/bill-payment', {
    schema: {
      body: {
        type: 'object',
        required: ['customerId', 'businessId', 'maxAmount'],
        properties: {
          customerId: { type: 'string', description: 'Customer MSISDN' },
          businessId: { type: 'string', description: 'Utility/service provider name' },
          maxAmount: { type: 'number', minimum: 1, description: 'Maximum amount per bill in XAF' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
    },
  }, consentController.createBillPaymentConsent.bind(consentController));

  // Account access consent
  app.post('/consent/account-access', {
    schema: {
      body: {
        type: 'object',
        required: ['customerId', 'businessId'],
        properties: {
          customerId: { type: 'string', description: 'Customer MSISDN' },
          businessId: { type: 'string', description: 'App/service requesting access' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
    },
  }, consentController.createAccountAccessConsent.bind(consentController));

  // Get access token from authorization (polling endpoint)
  app.get('/consent/token/:authReqId', {
    schema: {
      params: {
        type: 'object',
        required: ['authReqId'],
        properties: {
          authReqId: { type: 'string', description: 'Authorization request ID from consent creation' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                tokenType: { type: 'string' },
                expiresIn: { type: 'number' },
                refreshToken: { type: 'string' },
                refreshExpiresIn: { type: 'number' },
              },
            },
          },
        },
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, consentController.getTokenFromConsent.bind(consentController));

  // Get user info using OAuth2 token
  app.post('/consent/userinfo', {
    schema: {
      body: {
        type: 'object',
        required: ['accessToken'],
        properties: {
          accessToken: { type: 'string', description: 'OAuth2 access token' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                userInfo: {
                  type: 'object',
                  properties: {
                    sub: { type: 'string' },
                    name: { type: 'string' },
                    given_name: { type: 'string' },
                    family_name: { type: 'string' },
                    birthdate: { type: 'string' },
                    locale: { type: 'string' },
                    gender: { type: 'string' },
                    updated_at: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, consentController.getUserInfoFromToken.bind(consentController));

  // Refresh OAuth2 token
  app.post('/consent/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', description: 'OAuth2 refresh token' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                tokenType: { type: 'string' },
                expiresIn: { type: 'number' },
                refreshToken: { type: 'string' },
                refreshExpiresIn: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, consentController.refreshToken.bind(consentController));

  // Revoke OAuth2 consent
  app.post('/consent/revoke', {
    schema: {
      body: {
        type: 'object',
        required: ['accessToken'],
        properties: {
          accessToken: { type: 'string', description: 'OAuth2 access token to revoke' },
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, consentController.revokeConsent.bind(consentController));

  // Get basic user info without consent
  app.get('/user/basic/:msisdn', {
    schema: {
      params: {
        type: 'object',
        required: ['msisdn'],
        properties: {
          msisdn: { type: 'string', description: 'User MSISDN (phone number)' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['MTN', 'ORANGE'], default: 'MTN' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                userInfo: {
                  type: 'object',
                  properties: {
                    given_name: { type: 'string' },
                    family_name: { type: 'string' },
                    birthdate: { type: 'string' },
                    locale: { type: 'string' },
                    gender: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, consentController.getBasicUserInfo.bind(consentController));
}