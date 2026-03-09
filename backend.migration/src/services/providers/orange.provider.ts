import { PaymentProvider, PaymentRequest, PaymentResponse, PaymentStatus, PaymentStatusEnum, RefundResponse, HealthStatus, ProviderTransaction, DepositRequest, DepositResponse, DepositStatus, DepositStatusEnum, TransferRequest, TransferResponse, TransferStatus, TransferStatusEnum } from './provider.interface';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

interface OrangeAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface OrangePaymentInit {
  merchant_key: string;
  currency: string;
  order_id: string;
  amount: number;
  return_url: string;
  cancel_url: string;
  notif_url: string;
  lang: string;
  reference: string;
}

interface OrangePaymentResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'EXPIRED';
  pay_token: string;
  payment_url: string;
  notif_token: string;
  txnid: string;
}

export class OrangeMoneyProvider implements PaymentProvider {
  public readonly name = 'Orange Money';
  public readonly environment: 'sandbox' | 'production';
  private baseUrl: string;
  private merchantKey: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(environment?: 'sandbox' | 'production') {
    this.environment = environment || (env.NODE_ENV === 'production' ? 'production' : 'sandbox');
    this.baseUrl = this.environment === 'production'
      ? 'https://api.orange.com/orange-money-webpay/cm'
      : 'https://api.orange.com/orange-money-webpay/cm/sandbox';

    this.merchantKey = env.ORANGE_MERCHANT_KEY || '';
    this.clientId = env.ORANGE_CLIENT_ID || '';
    this.clientSecret = env.ORANGE_CLIENT_SECRET || '';

    logger.info(`Orange Money provider initialized in ${this.environment} mode → ${this.baseUrl}`);
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await fetch(`${this.baseUrl}/oauth/v2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        throw new Error(`Failed to get Orange access token: ${response.statusText}`);
      }

      const data = await response.json() as OrangeAuthToken;

      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000); // Refresh 1 minute before expiry

      logger.info('Orange access token refreshed successfully');
      return this.accessToken;
    } catch (error) {
      logger.error({ error }, 'Failed to get Orange access token');
      throw error;
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Remove @cameroon suffix and any non-digit characters
    const cleaned = phone.replace(/@cameroon$/, '').replace(/\D/g, '');

    // Orange Money expects full international format
    if (!cleaned.startsWith('237')) {
      return `237${cleaned}`;
    }

    return cleaned;
  }

  async initiatePayment(params: PaymentRequest): Promise<PaymentResponse> {
    try {
      const accessToken = await this.getAccessToken();

      const orangeRequest: OrangePaymentInit = {
        merchant_key: this.merchantKey,
        currency: params.currency || 'XAF',
        order_id: params.transactionId,
        amount: params.amount,
        return_url: `${env.FRONTEND_URL}/payment/callback`,
        cancel_url: `${env.FRONTEND_URL}/payment/cancel`,
        notif_url: `${env.API_URL}/webhooks/provider/orange`,
        lang: 'fr',
        reference: params.description || `Payment ${params.transactionId}`,
      };

      const response = await fetch(`${this.baseUrl}/v1/webpayment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orangeRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ statusCode: response.status, error }, 'Orange payment initiation failed');

        return {
          success: false,
          providerTransactionId: '',
          status: PaymentStatusEnum.FAILED,
          message: `Payment initiation failed: ${error}`,
          timestamp: new Date(),
        };
      }

      const data = await response.json() as OrangePaymentResponse;

      // For Orange Money, the user needs to complete payment via web or USSD
      // Store the payment URL for user redirection
      return {
        success: true,
        providerTransactionId: data.txnid,
        status: PaymentStatusEnum.PENDING,
        message: `Payment initiated. User must complete via Orange Money. Payment URL: ${data.payment_url}`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error }, 'Orange payment initiation error');

      return {
        success: false,
        providerTransactionId: '',
        status: PaymentStatusEnum.FAILED,
        message: error.message,
        timestamp: new Date(),
      };
    }
  }

  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const accessToken = await this.getAccessToken();

      const response = await fetch(
        `${this.baseUrl}/v1/transactionstatus?order_id=${transactionId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to check payment status: ${response.statusText}`);
      }

      const data = await response.json() as any;

      let status: PaymentStatusEnum;
      switch (data.status) {
        case 'SUCCESS':
          status = PaymentStatusEnum.COMPLETED;
          break;
        case 'FAILED':
          status = PaymentStatusEnum.FAILED;
          break;
        case 'EXPIRED':
          status = PaymentStatusEnum.EXPIRED;
          break;
        case 'PENDING':
        default:
          status = PaymentStatusEnum.PENDING;
      }

      return {
        transactionId,
        providerTransactionId: data.txnid || transactionId,
        status,
        amount: data.amount || 0,
        completedAt: status === PaymentStatusEnum.COMPLETED ? new Date() : undefined,
        failureReason: data.message,
      };
    } catch (error: any) {
      logger.error({ error, transactionId }, 'Failed to check Orange payment status');

      return {
        transactionId,
        providerTransactionId: transactionId,
        status: PaymentStatusEnum.FAILED,
        amount: 0,
        failureReason: error.message,
      };
    }
  }

  async refund(transactionId: string, amount?: number): Promise<RefundResponse> {
    // Orange Money refund implementation would go here
    logger.info({ transactionId, amount }, 'Orange refund requested');

    return {
      success: false,
      refundId: '',
      amount: amount || 0,
      status: 'PENDING' as any,
      message: 'Refund functionality not yet implemented for Orange Money',
    };
  }

  verifyWebhook(payload: any, signature: string): boolean {
    // Orange webhook verification
    // Orange uses a notification token for verification
    if (!payload.notif_token) {
      return false;
    }

    // In production, verify the notif_token matches what was stored during payment init
    logger.info({ payload, signature }, 'Orange webhook verification');
    return true;
  }

  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      // Try to get an access token as a health check
      await this.getAccessToken();

      return {
        healthy: true,
        latency: Date.now() - startTime,
        message: 'Orange Money API is operational',
      };
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        message: `Orange API health check failed: ${error.message}`,
      };
    }
  }

  async getTransactions(startDate: Date, endDate: Date): Promise<ProviderTransaction[]> {
    try {
      const accessToken = await this.getAccessToken();

      // Orange Money transaction history API
      // In production, this would fetch real transactions
      const response = await fetch(`${this.baseUrl}/v1/transactions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
        // Add query parameters for date range
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Failed to fetch Orange transactions');
        return [];
      }

      const data = await response.json() as any;

      // Map Orange transaction format to our format
      return (data.transactions || []).map((tx: any) => ({
        transactionId: tx.order_id,
        providerTransactionId: tx.txnid,
        amount: tx.amount,
        fee: tx.fee || 0,
        status: tx.status,
        from: tx.customer_msisdn || '',
        to: tx.merchant_msisdn || '',
        timestamp: new Date(tx.created_at),
        metadata: tx.metadata,
      }));
    } catch (error) {
      logger.error({ error, startDate, endDate }, 'Error fetching Orange transactions');
      return [];
    }
  }

  // Missing PaymentProvider method implementations
  async checkRefundStatus(_refundId: string): Promise<import('./provider.interface.ts').RefundStatus> {
    throw new Error('Check refund status not implemented for Orange Money provider');
  }

  async transfer(params: TransferRequest): Promise<TransferResponse> {
    // Orange Money disbursement (B2C) may require business partnership
    // For now, this is not implemented in the public API
    logger.warn({ transferId: params.transferId, amount: params.amount }, 'Orange Money transfer (disbursement) not implemented - requires business partnership');

    return {
      success: false,
      transferId: params.transferId,
      providerTransferId: '',
      status: TransferStatusEnum.FAILED,
      message: 'Transfer functionality not yet implemented for Orange Money provider. Requires business partnership for B2C disbursements.',
      timestamp: new Date(),
    };
  }

  async checkTransferStatus(transferId: string): Promise<TransferStatus> {
    logger.warn({ transferId }, 'Orange Money transfer status check not implemented');

    return {
      transferId,
      providerTransferId: transferId,
      status: TransferStatusEnum.FAILED,
      amount: 0,
      failureReason: 'Transfer functionality not implemented for Orange Money provider',
    };
  }

  async getBalance(): Promise<import('./provider.interface.ts').BalanceResponse> {
    throw new Error('Get balance not implemented for Orange Money provider');
  }

  async validateRecipient(_accountId: string, _accountType: string): Promise<import('./provider.interface.ts').ValidationResponse> {
    throw new Error('Validate recipient not implemented for Orange Money provider');
  }

  async getUserInfo(_accountId: string, _accountType: string): Promise<import('./provider.interface.ts').UserInfoResponse> {
    throw new Error('Get user info not implemented for Orange Money provider');
  }

  async deposit(params: DepositRequest): Promise<DepositResponse> {
    try {
      logger.info({ depositId: params.depositId, accountId: params.accountId, amount: params.amount }, 'Initiating Orange Money deposit');

      const accessToken = await this.getAccessToken();

      const orangeRequest: OrangePaymentInit = {
        merchant_key: this.merchantKey,
        currency: params.currency || 'XAF',
        order_id: params.depositId,
        amount: params.amount,
        return_url: `${env.FRONTEND_URL}/payment/callback`,
        cancel_url: `${env.FRONTEND_URL}/payment/cancel`,
        notif_url: `${env.API_URL}/webhooks/provider/orange`,
        lang: 'fr',
        reference: params.description || `Deposit ${params.depositId}`,
      };

      const response = await fetch(`${this.baseUrl}/v1/webpayment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orangeRequest),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ statusCode: response.status, error, depositId: params.depositId }, 'Orange deposit initiation failed');

        return {
          success: false,
          depositId: params.depositId,
          providerDepositId: '',
          status: DepositStatusEnum.FAILED,
          message: `Deposit initiation failed: ${error}`,
          timestamp: new Date(),
        };
      }

      const data = await response.json() as OrangePaymentResponse;

      logger.info({ depositId: params.depositId, txnid: data.txnid, status: data.status }, 'Orange deposit initiated successfully');

      return {
        success: true,
        depositId: params.depositId,
        providerDepositId: data.txnid,
        status: DepositStatusEnum.PENDING,
        message: `Deposit initiated. User must complete via Orange Money.`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error, depositId: params.depositId }, 'Orange deposit initiation error');

      return {
        success: false,
        depositId: params.depositId,
        providerDepositId: '',
        status: DepositStatusEnum.FAILED,
        message: error.message,
        timestamp: new Date(),
      };
    }
  }

  async checkDepositStatus(depositId: string): Promise<DepositStatus> {
    try {
      logger.info({ depositId }, 'Checking Orange Money deposit status');

      const status = await this.checkStatus(depositId);

      logger.info({ depositId, status: status.status }, 'Orange deposit status checked');

      return {
        depositId,
        providerDepositId: status.providerTransactionId,
        status: status.status === PaymentStatusEnum.COMPLETED ? DepositStatusEnum.COMPLETED :
               status.status === PaymentStatusEnum.FAILED ? DepositStatusEnum.FAILED :
               status.status === PaymentStatusEnum.PENDING ? DepositStatusEnum.PENDING :
               DepositStatusEnum.FAILED,
        amount: status.amount,
        fee: status.fee,
        completedAt: status.completedAt,
        failureReason: status.failureReason,
        financialTransactionId: status.financialTransactionId,
      };
    } catch (error: any) {
      logger.error({ error, depositId }, 'Failed to check Orange deposit status');

      return {
        depositId,
        providerDepositId: depositId,
        status: DepositStatusEnum.FAILED,
        amount: 0,
        failureReason: error.message,
      };
    }
  }

  async createPreApproval(_params: import('./provider.interface.ts').PreApprovalRequest): Promise<import('./provider.interface.ts').PreApprovalResponse> {
    throw new Error('Create pre-approval not implemented for Orange Money provider');
  }

  async getPreApprovalStatus(_referenceId: string): Promise<import('./provider.interface.ts').PreApprovalStatus> {
    throw new Error('Get pre-approval status not implemented for Orange Money provider');
  }

  async cancelPreApproval(_referenceId: string): Promise<import('./provider.interface.ts').PreApprovalCancelResponse> {
    throw new Error('Cancel pre-approval not implemented for Orange Money provider');
  }

  async bcAuthorize(_params: import('./provider.interface.ts').BCAuthorizeRequest): Promise<import('./provider.interface.ts').BCAuthorizeResponse> {
    throw new Error('BC authorize not implemented for Orange Money provider');
  }

  async createOAuth2Token(_params: import('./provider.interface.ts').OAuth2TokenRequest): Promise<import('./provider.interface.ts').OAuth2TokenResponse> {
    throw new Error('Create OAuth2 token not implemented for Orange Money provider');
  }

  async getOAuth2UserInfo(_accessToken: string): Promise<import('./provider.interface.ts').OAuth2UserInfoResponse> {
    throw new Error('Get OAuth2 user info not implemented for Orange Money provider');
  }

  async refreshOAuth2Token(_refreshToken: string): Promise<import('./provider.interface.ts').OAuth2TokenResponse> {
    throw new Error('Refresh OAuth2 token not implemented for Orange Money provider');
  }

  async revokeOAuth2Consent(_accessToken: string): Promise<import('./provider.interface.ts').RevokeConsentResponse> {
    throw new Error('Revoke OAuth2 consent not implemented for Orange Money provider');
  }

  async getBasicUserInfo(_msisdn: string): Promise<import('./provider.interface.ts').BasicUserInfoResponse> {
    throw new Error('Get basic user info not implemented for Orange Money provider');
  }

  async requestWithdraw(_params: import('./provider.interface.ts').WithdrawRequest): Promise<import('./provider.interface.ts').WithdrawResponse> {
    throw new Error('Request withdraw not implemented for Orange Money provider');
  }

  async checkWithdrawStatus(_withdrawId: string): Promise<import('./provider.interface.ts').WithdrawStatus> {
    throw new Error('Check withdraw status not implemented for Orange Money provider');
  }
}
