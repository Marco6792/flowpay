import {
  PaymentProvider,
  PaymentRequest,
  PaymentResponse,
  PaymentStatus,
  PaymentStatusEnum,
  RefundResponse,
  RefundStatusEnum,
  HealthStatus,
  ProviderTransaction,
  TransferRequest,
  TransferResponse,
  TransferStatus,
  TransferStatusEnum,
  BalanceResponse,
  ValidationResponse,
  UserInfoResponse,
  DepositRequest,
  DepositResponse,
  DepositStatusEnum,
  DepositStatus,
  BCAuthorizeRequest,
  BCAuthorizeResponse,
  OAuth2TokenRequest,
  OAuth2TokenResponse,
  OAuth2UserInfoResponse,
  RevokeConsentResponse,
  BasicUserInfoResponse,
  PreApprovalRequest,
  PreApprovalResponse,
  PreApprovalStatus,
  PreApprovalStatusEnum,
  WithdrawRequest,
  WithdrawResponse,
  WithdrawStatus,
  WithdrawStatusEnum,
} from "./provider.interface.ts";
import {
  RefundTransactionErrorCode,
  RefundTransactionErrorMessages,
  createRefundError,
  mapProviderErrorToRefundError,
} from "../../types/refund-errors.ts";
import { env } from "../../config/env.ts";
import { logger } from "../../utils/logger.ts";
import axios from "axios";
import crypto from "crypto";

// Additional interfaces for new features
interface NotificationResponse {
  success: boolean;
  message: string;
}

interface RefundStatus {
  refundId: string;
  status: RefundStatusEnum;
  amount: number;
  completedAt?: Date;
  failureReason?: string;
}

interface MTNAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface MTNPaymentRequest {
  amount: string;
  currency: string;
  externalId: string;
  payer: {
    partyIdType: "MSISDN";
    partyId: string;
  };
  payerMessage: string;
  payeeNote: string;
}

interface MTNPaymentStatus {
  status:
    | "PENDING"
    | "SUCCESSFUL"
    | "FAILED"
    | "REJECTED"
    | "APPROVAL_REJECTED"
    | "CANCELLED";
  amount: string;
  currency: string;
  financialTransactionId?: string;
  externalId: string;
  payer?: {
    partyIdType: string;
    partyId: string;
  };
  reason?: string;
}

export class MTNMobileMoneyProvider implements PaymentProvider {
  public readonly name = "MTN Mobile Money";
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private apiUser: string;
  private collectionSubscriptionKey: string;
  private disbursementSubscriptionKey: string;
  private remittanceSubscriptionKey: string;
  private subscriptionKey: string; // Legacy - kept for backward compatibility
  private targetEnvironment: string;
  private callbackUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.targetEnvironment = env.MTN_TARGET_ENVIRONMENT || "sandbox";
    this.baseUrl =
      this.targetEnvironment === "production"
        ? "https://proxy.momoapi.mtn.com"
        : env.MTN_API_URL || "https://sandbox.momodeveloper.mtn.com";

    this.apiUser = env.MTN_API_USER || ""; // API User ID (UUID)
    this.apiKey = env.MTN_API_KEY || ""; // API Key acts as password
    this.apiSecret = env.MTN_API_KEY || ""; // Use API key as secret for auth

    // Use specific subscription keys or fall back to legacy key
    this.collectionSubscriptionKey =
      env.MTN_COLLECTION_SUBSCRIPTION_KEY || env.MTN_SUBSCRIPTION_KEY || "";
    this.disbursementSubscriptionKey =
      env.MTN_DISBURSEMENT_SUBSCRIPTION_KEY || env.MTN_SUBSCRIPTION_KEY || "";
    this.remittanceSubscriptionKey =
      env.MTN_REMITTANCE_SUBSCRIPTION_KEY || env.MTN_SUBSCRIPTION_KEY || "";
    this.subscriptionKey = env.MTN_SUBSCRIPTION_KEY || ""; // Legacy support

    this.callbackUrl =
      env.MTN_CALLBACK_URL || `${env.API_URL}${env.API_PREFIX}/webhooks/mtn`;

    if (!this.apiKey || !this.apiSecret || !this.collectionSubscriptionKey) {
      logger.warn(
        "MTN Mobile Money provider not fully configured. Missing API credentials."
      );
    }
  }

  /**
   * FlowPay Test Numbers - Map FlowPay test numbers to MTN sandbox test numbers
   * This allows merchants to use FlowPay-branded test numbers while internally
   * mapping to the actual MTN sandbox test numbers for different scenarios.
   *
   * Pattern: FlowPay Number || MTN Test Number
   */
  private static readonly FLOWPAY_TEST_NUMBER_MAPPING: Record<
    string,
    { mtnNumber: string; scenario: string }
  > = {
    // FlowPay Success Numbers || MTN Success Numbers
    "237670000000@cameroon": {
      mtnNumber: "46733999999",
      scenario: "IMMEDIATE_SUCCESS",
    },
    "237670000001@cameroon": {
      mtnNumber: "46733999998",
      scenario: "IMMEDIATE_SUCCESS",
    },
    "237680000000@cameroon": { mtnNumber: "56733123453", scenario: "ONGOING" }, // Deposit/Transfer Ongoing

    // FlowPay Deposit Test Scenarios (237680000XXX) - Based on MTN Deposit Payer scenarios
    "237680000450@cameroon": {
      mtnNumber: "46733123450",
      scenario: "DEPOSIT_PAYER_FAILED",
    },
    "237680000450": {
      mtnNumber: "46733123450",
      scenario: "DEPOSIT_PAYER_FAILED",
    },
    "237680000451@cameroon": {
      mtnNumber: "46733123451",
      scenario: "DEPOSIT_PAYER_REJECTED",
    },
    "237680000451": {
      mtnNumber: "46733123451",
      scenario: "DEPOSIT_PAYER_REJECTED",
    },
    "237680000452@cameroon": {
      mtnNumber: "46733123452",
      scenario: "DEPOSIT_PAYER_EXPIRED",
    },
    "237680000452": {
      mtnNumber: "46733123452",
      scenario: "DEPOSIT_PAYER_EXPIRED",
    },
    "237680000453@cameroon": {
      mtnNumber: "46733123453",
      scenario: "DEPOSIT_PAYER_ONGOING",
    },
    "237680000453": {
      mtnNumber: "46733123453",
      scenario: "DEPOSIT_PAYER_ONGOING",
    },
    "237680000454@cameroon": {
      mtnNumber: "46733123454",
      scenario: "DEPOSIT_PAYER_DELAYED",
    },
    "237680000454": {
      mtnNumber: "46733123454",
      scenario: "DEPOSIT_PAYER_DELAYED",
    },
    "237680000455@cameroon": {
      mtnNumber: "46733123455",
      scenario: "DEPOSIT_PAYER_NOT_FOUND",
    },
    "237680000455": {
      mtnNumber: "46733123455",
      scenario: "DEPOSIT_PAYER_NOT_FOUND",
    },
    "237680000456@cameroon": {
      mtnNumber: "46733123456",
      scenario: "DEPOSIT_PAYER_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237680000456": {
      mtnNumber: "46733123456",
      scenario: "DEPOSIT_PAYER_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237680000457@cameroon": {
      mtnNumber: "46733123457",
      scenario: "DEPOSIT_PAYER_NOT_ALLOWED",
    },
    "237680000457": {
      mtnNumber: "46733123457",
      scenario: "DEPOSIT_PAYER_NOT_ALLOWED",
    },
    "237680000458@cameroon": {
      mtnNumber: "46733123458",
      scenario: "DEPOSIT_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237680000458": {
      mtnNumber: "46733123458",
      scenario: "DEPOSIT_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237680000459@cameroon": {
      mtnNumber: "46733123459",
      scenario: "DEPOSIT_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237680000459": {
      mtnNumber: "46733123459",
      scenario: "DEPOSIT_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237680000460@cameroon": {
      mtnNumber: "46733123460",
      scenario: "DEPOSIT_PAYER_INVALID_CURRENCY",
    },
    "237680000460": {
      mtnNumber: "46733123460",
      scenario: "DEPOSIT_PAYER_INVALID_CURRENCY",
    },
    "237680000461@cameroon": {
      mtnNumber: "46733123461",
      scenario: "DEPOSIT_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237680000461": {
      mtnNumber: "46733123461",
      scenario: "DEPOSIT_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237680000462@cameroon": {
      mtnNumber: "46733123462",
      scenario: "DEPOSIT_PAYER_SERVICE_UNAVAILABLE",
    },
    "237680000462": {
      mtnNumber: "46733123462",
      scenario: "DEPOSIT_PAYER_SERVICE_UNAVAILABLE",
    },
    "237680000463@cameroon": {
      mtnNumber: "46733123463",
      scenario: "DEPOSIT_PAYER_COULD_NOT_PERFORM_TRANSACTION",
    },
    "237680000463": {
      mtnNumber: "46733123463",
      scenario: "DEPOSIT_PAYER_COULD_NOT_PERFORM_TRANSACTION",
    },

    // FlowPay Transfer Test Scenarios (237690000XXX) - Based on MTN Transfer Payee scenarios
    "237690000450@cameroon": {
      mtnNumber: "46733123450",
      scenario: "TRANSFER_PAYEE_FAILED",
    },
    "237690000450": {
      mtnNumber: "46733123450",
      scenario: "TRANSFER_PAYEE_FAILED",
    },
    "237690000451@cameroon": {
      mtnNumber: "46733123451",
      scenario: "TRANSFER_PAYEE_REJECTED",
    },
    "237690000451": {
      mtnNumber: "46733123451",
      scenario: "TRANSFER_PAYEE_REJECTED",
    },
    "237690000452@cameroon": {
      mtnNumber: "46733123452",
      scenario: "TRANSFER_PAYEE_EXPIRED",
    },
    "237690000452": {
      mtnNumber: "46733123452",
      scenario: "TRANSFER_PAYEE_EXPIRED",
    },
    "237690000453@cameroon": {
      mtnNumber: "46733123453",
      scenario: "TRANSFER_PAYEE_ONGOING",
    },
    "237690000453": {
      mtnNumber: "46733123453",
      scenario: "TRANSFER_PAYEE_ONGOING",
    },
    "237690000454@cameroon": {
      mtnNumber: "46733123454",
      scenario: "TRANSFER_PAYEE_DELAYED",
    },
    "237690000454": {
      mtnNumber: "46733123454",
      scenario: "TRANSFER_PAYEE_DELAYED",
    },
    "237690000455@cameroon": {
      mtnNumber: "46733123455",
      scenario: "TRANSFER_PAYEE_NOT_ENOUGH_FUNDS",
    },
    "237690000455": {
      mtnNumber: "46733123455",
      scenario: "TRANSFER_PAYEE_NOT_ENOUGH_FUNDS",
    },
    "237690000456@cameroon": {
      mtnNumber: "46733123456",
      scenario: "TRANSFER_PAYEE_PAYER_LIMIT_REACHED",
    },
    "237690000456": {
      mtnNumber: "46733123456",
      scenario: "TRANSFER_PAYEE_PAYER_LIMIT_REACHED",
    },
    "237690000457@cameroon": {
      mtnNumber: "46733123457",
      scenario: "TRANSFER_PAYEE_NOT_FOUND",
    },
    "237690000457": {
      mtnNumber: "46733123457",
      scenario: "TRANSFER_PAYEE_NOT_FOUND",
    },
    "237690000458@cameroon": {
      mtnNumber: "46733123458",
      scenario: "TRANSFER_PAYEE_NOT_ALLOWED",
    },
    "237690000458": {
      mtnNumber: "46733123458",
      scenario: "TRANSFER_PAYEE_NOT_ALLOWED",
    },
    "237690000459@cameroon": {
      mtnNumber: "46733123459",
      scenario: "TRANSFER_PAYEE_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237690000459": {
      mtnNumber: "46733123459",
      scenario: "TRANSFER_PAYEE_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237690000460@cameroon": {
      mtnNumber: "46733123460",
      scenario: "TRANSFER_PAYEE_INVALID_CALLBACK_URL_HOST",
    },
    "237690000460": {
      mtnNumber: "46733123460",
      scenario: "TRANSFER_PAYEE_INVALID_CALLBACK_URL_HOST",
    },
    "237690000461@cameroon": {
      mtnNumber: "46733123461",
      scenario: "TRANSFER_PAYEE_INVALID_CURRENCY",
    },
    "237690000461": {
      mtnNumber: "46733123461",
      scenario: "TRANSFER_PAYEE_INVALID_CURRENCY",
    },
    "237690000462@cameroon": {
      mtnNumber: "46733123462",
      scenario: "TRANSFER_PAYEE_INTERNAL_PROCESSING_ERROR",
    },
    "237690000462": {
      mtnNumber: "46733123462",
      scenario: "TRANSFER_PAYEE_INTERNAL_PROCESSING_ERROR",
    },
    "237690000463@cameroon": {
      mtnNumber: "46733123463",
      scenario: "TRANSFER_PAYEE_SERVICE_UNAVAILABLE",
    },
    "237690000463": {
      mtnNumber: "46733123463",
      scenario: "TRANSFER_PAYEE_SERVICE_UNAVAILABLE",
    },

    // FlowPay Withdrawal Test Scenarios (237710000XXX) - Based on MTN RequestToWithdraw scenarios
    "237710000400@cameroon": {
      mtnNumber: "46733123400",
      scenario: "WITHDRAWAL_SUCCESS",
    },
    "237710000400": {
      mtnNumber: "46733123400",
      scenario: "WITHDRAWAL_SUCCESS",
    },
    "237710000450@cameroon": {
      mtnNumber: "46733123450",
      scenario: "WITHDRAWAL_PAYER_FAILED",
    },
    "237710000450": {
      mtnNumber: "46733123450",
      scenario: "WITHDRAWAL_PAYER_FAILED",
    },
    "237710000451@cameroon": {
      mtnNumber: "46733123451",
      scenario: "WITHDRAWAL_PAYER_REJECTED",
    },
    "237710000451": {
      mtnNumber: "46733123451",
      scenario: "WITHDRAWAL_PAYER_REJECTED",
    },
    "237710000452@cameroon": {
      mtnNumber: "46733123452",
      scenario: "WITHDRAWAL_PAYER_EXPIRED",
    },
    "237710000452": {
      mtnNumber: "46733123452",
      scenario: "WITHDRAWAL_PAYER_EXPIRED",
    },
    "237710000453@cameroon": {
      mtnNumber: "46733123453",
      scenario: "WITHDRAWAL_PAYER_ONGOING",
    },
    "237710000453": {
      mtnNumber: "46733123453",
      scenario: "WITHDRAWAL_PAYER_ONGOING",
    },
    "237710000454@cameroon": {
      mtnNumber: "46733123454",
      scenario: "WITHDRAWAL_PAYER_DELAYED",
    },
    "237710000454": {
      mtnNumber: "46733123454",
      scenario: "WITHDRAWAL_PAYER_DELAYED",
    },
    "237710000455@cameroon": {
      mtnNumber: "46733123455",
      scenario: "WITHDRAWAL_PAYER_NOT_FOUND",
    },
    "237710000455": {
      mtnNumber: "46733123455",
      scenario: "WITHDRAWAL_PAYER_NOT_FOUND",
    },
    "237710000456@cameroon": {
      mtnNumber: "46733123456",
      scenario: "WITHDRAWAL_PAYER_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237710000456": {
      mtnNumber: "46733123456",
      scenario: "WITHDRAWAL_PAYER_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237710000457@cameroon": {
      mtnNumber: "46733123457",
      scenario: "WITHDRAWAL_PAYER_NOT_ALLOWED",
    },
    "237710000457": {
      mtnNumber: "46733123457",
      scenario: "WITHDRAWAL_PAYER_NOT_ALLOWED",
    },
    "237710000458@cameroon": {
      mtnNumber: "46733123458",
      scenario: "WITHDRAWAL_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237710000458": {
      mtnNumber: "46733123458",
      scenario: "WITHDRAWAL_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237710000459@cameroon": {
      mtnNumber: "46733123459",
      scenario: "WITHDRAWAL_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237710000459": {
      mtnNumber: "46733123459",
      scenario: "WITHDRAWAL_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237710000460@cameroon": {
      mtnNumber: "46733123460",
      scenario: "WITHDRAWAL_PAYER_INVALID_CURRENCY",
    },
    "237710000460": {
      mtnNumber: "46733123460",
      scenario: "WITHDRAWAL_PAYER_INVALID_CURRENCY",
    },
    "237710000461@cameroon": {
      mtnNumber: "46733123461",
      scenario: "WITHDRAWAL_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237710000461": {
      mtnNumber: "46733123461",
      scenario: "WITHDRAWAL_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237710000462@cameroon": {
      mtnNumber: "46733123462",
      scenario: "WITHDRAWAL_PAYER_COULD_NOT_PERFORM_TRANSACTION",
    },
    "237710000462": {
      mtnNumber: "46733123462",
      scenario: "WITHDRAWAL_PAYER_COULD_NOT_PERFORM_TRANSACTION",
    },
    "237710000463@cameroon": {
      mtnNumber: "46733123463",
      scenario: "WITHDRAWAL_PAYER_SERVICE_UNAVAILABLE",
    },
    "237710000463": {
      mtnNumber: "46733123463",
      scenario: "WITHDRAWAL_PAYER_SERVICE_UNAVAILABLE",
    },

    // FlowPay Payment PreApproval Test Scenarios (237670000XXX)
    "237670000010@cameroon": {
      mtnNumber: "46733123450",
      scenario: "PAYMENT_PREAPPROVAL_PAYER_FAILED",
    },
    "237670000010": {
      mtnNumber: "46733123450",
      scenario: "PAYMENT_PREAPPROVAL_PAYER_FAILED",
    },
    "237670000011@cameroon": {
      mtnNumber: "46733123451",
      scenario: "PAYMENT_PREAPPROVAL_PAYEE_DECLINED",
    },
    "237670000011": {
      mtnNumber: "46733123451",
      scenario: "PAYMENT_PREAPPROVAL_PAYEE_DECLINED",
    },
    "237670000012@cameroon": {
      mtnNumber: "46733123452",
      scenario: "PAYMENT_PREAPPROVAL_TIMEOUT",
    },
    "237670000012": {
      mtnNumber: "46733123452",
      scenario: "PAYMENT_PREAPPROVAL_TIMEOUT",
    },
    "237670000013@cameroon": {
      mtnNumber: "46733123453",
      scenario: "PAYMENT_PREAPPROVAL_EXPIRED",
    },
    "237670000013": {
      mtnNumber: "46733123453",
      scenario: "PAYMENT_PREAPPROVAL_EXPIRED",
    },
    "237670000014@cameroon": {
      mtnNumber: "46733123454",
      scenario: "PAYMENT_PREAPPROVAL_PENDING",
    },
    "237670000014": {
      mtnNumber: "46733123454",
      scenario: "PAYMENT_PREAPPROVAL_PENDING",
    },
    "237670000015@cameroon": {
      mtnNumber: "46733123455",
      scenario: "PAYMENT_INSUFFICIENT_FUNDS",
    },
    "237670000015": {
      mtnNumber: "46733123455",
      scenario: "PAYMENT_INSUFFICIENT_FUNDS",
    },
    "237670000016@cameroon": {
      mtnNumber: "46733123456",
      scenario: "PAYMENT_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237670000016": {
      mtnNumber: "46733123456",
      scenario: "PAYMENT_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237670000017@cameroon": {
      mtnNumber: "46733123457",
      scenario: "PAYMENT_PAYER_NOT_ALLOWED",
    },
    "237670000017": {
      mtnNumber: "46733123457",
      scenario: "PAYMENT_PAYER_NOT_ALLOWED",
    },
    "237670000018@cameroon": {
      mtnNumber: "46733123458",
      scenario: "PAYMENT_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237670000018": {
      mtnNumber: "46733123458",
      scenario: "PAYMENT_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237670000019@cameroon": {
      mtnNumber: "46733123459",
      scenario: "PAYMENT_INVALID_CALLBACK_URL_HOST",
    },
    "237670000019": {
      mtnNumber: "46733123459",
      scenario: "PAYMENT_INVALID_CALLBACK_URL_HOST",
    },

    // FlowPay Delayed Success
    "237670000020@cameroon": {
      mtnNumber: "46733123454",
      scenario: "DELAYED_SUCCESS",
    },
    "237670000020": { mtnNumber: "46733123454", scenario: "DELAYED_SUCCESS" },

    // FlowPay PreApproval API Test Scenarios (2377XXXXX@cameroon)
    "237700000450@cameroon": {
      mtnNumber: "46733123450",
      scenario: "PREAPPROVAL_PAYER_FAILED",
    },
    "237700000450": {
      mtnNumber: "46733123450",
      scenario: "PREAPPROVAL_PAYER_FAILED",
    },
    "237700000451@cameroon": {
      mtnNumber: "46733123451",
      scenario: "PREAPPROVAL_PAYER_REJECTED",
    },
    "237700000451": {
      mtnNumber: "46733123451",
      scenario: "PREAPPROVAL_PAYER_REJECTED",
    },
    "237700000452@cameroon": {
      mtnNumber: "46733123452",
      scenario: "PREAPPROVAL_PAYER_EXPIRED",
    },
    "237700000452": {
      mtnNumber: "46733123452",
      scenario: "PREAPPROVAL_PAYER_EXPIRED",
    },
    "237700000453@cameroon": {
      mtnNumber: "46733123453",
      scenario: "PREAPPROVAL_PAYER_ONGOING",
    },
    "237700000453": {
      mtnNumber: "46733123453",
      scenario: "PREAPPROVAL_PAYER_ONGOING",
    },
    "237700000454@cameroon": {
      mtnNumber: "46733123454",
      scenario: "PREAPPROVAL_PAYER_DELAYED",
    },
    "237700000454": {
      mtnNumber: "46733123454",
      scenario: "PREAPPROVAL_PAYER_DELAYED",
    },
    "237700000455@cameroon": {
      mtnNumber: "46733123455",
      scenario: "PREAPPROVAL_PAYER_NOT_FOUND",
    },
    "237700000455": {
      mtnNumber: "46733123455",
      scenario: "PREAPPROVAL_PAYER_NOT_FOUND",
    },
    "237700000456@cameroon": {
      mtnNumber: "46733123456",
      scenario: "PREAPPROVAL_PAYER_NOT_ALLOWED",
    },
    "237700000456": {
      mtnNumber: "46733123456",
      scenario: "PREAPPROVAL_PAYER_NOT_ALLOWED",
    },
    "237700000457@cameroon": {
      mtnNumber: "46733123457",
      scenario: "PREAPPROVAL_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237700000457": {
      mtnNumber: "46733123457",
      scenario: "PREAPPROVAL_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237700000458@cameroon": {
      mtnNumber: "46733123458",
      scenario: "PREAPPROVAL_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237700000458": {
      mtnNumber: "46733123458",
      scenario: "PREAPPROVAL_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237700000459@cameroon": {
      mtnNumber: "46733123459",
      scenario: "PREAPPROVAL_PAYER_INVALID_CURRENCY",
    },
    "237700000459": {
      mtnNumber: "46733123459",
      scenario: "PREAPPROVAL_PAYER_INVALID_CURRENCY",
    },
    "237700000460@cameroon": {
      mtnNumber: "46733123460",
      scenario: "PREAPPROVAL_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237700000460": {
      mtnNumber: "46733123460",
      scenario: "PREAPPROVAL_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237700000461@cameroon": {
      mtnNumber: "46733123461",
      scenario: "PREAPPROVAL_PAYER_SERVICE_UNAVAILABLE",
    },
    "237700000461": {
      mtnNumber: "46733123461",
      scenario: "PREAPPROVAL_PAYER_SERVICE_UNAVAILABLE",
    },

    // FlowPay Request-to-Pay Test Scenarios (2376XXXXX@cameroon)
    "237600000450@cameroon": {
      mtnNumber: "46733123450",
      scenario: "REQUEST_TO_PAY_PAYER_FAILED",
    },
    "237600000450": {
      mtnNumber: "46733123450",
      scenario: "REQUEST_TO_PAY_PAYER_FAILED",
    },
    "237600000451@cameroon": {
      mtnNumber: "46733123451",
      scenario: "REQUEST_TO_PAY_PAYER_REJECTED",
    },
    "237600000451": {
      mtnNumber: "46733123451",
      scenario: "REQUEST_TO_PAY_PAYER_REJECTED",
    },
    "237600000452@cameroon": {
      mtnNumber: "46733123452",
      scenario: "REQUEST_TO_PAY_PAYER_EXPIRED",
    },
    "237600000452": {
      mtnNumber: "46733123452",
      scenario: "REQUEST_TO_PAY_PAYER_EXPIRED",
    },
    "237600000453@cameroon": {
      mtnNumber: "46733123453",
      scenario: "REQUEST_TO_PAY_PAYER_ONGOING",
    },
    "237600000453": {
      mtnNumber: "46733123453",
      scenario: "REQUEST_TO_PAY_PAYER_ONGOING",
    },
    "237600000454@cameroon": {
      mtnNumber: "46733123454",
      scenario: "REQUEST_TO_PAY_PAYER_DELAYED",
    },
    "237600000454": {
      mtnNumber: "46733123454",
      scenario: "REQUEST_TO_PAY_PAYER_DELAYED",
    },
    "237600000455@cameroon": {
      mtnNumber: "46733123455",
      scenario: "REQUEST_TO_PAY_PAYER_NOT_FOUND",
    },
    "237600000455": {
      mtnNumber: "46733123455",
      scenario: "REQUEST_TO_PAY_PAYER_NOT_FOUND",
    },
    "237600000456@cameroon": {
      mtnNumber: "46733123456",
      scenario: "REQUEST_TO_PAY_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237600000456": {
      mtnNumber: "46733123456",
      scenario: "REQUEST_TO_PAY_PAYEE_NOT_ALLOWED_TO_RECEIVE",
    },
    "237600000457@cameroon": {
      mtnNumber: "46733123457",
      scenario: "REQUEST_TO_PAY_PAYER_NOT_ALLOWED",
    },
    "237600000457": {
      mtnNumber: "46733123457",
      scenario: "REQUEST_TO_PAY_PAYER_NOT_ALLOWED",
    },
    "237600000458@cameroon": {
      mtnNumber: "46733123458",
      scenario: "REQUEST_TO_PAY_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237600000458": {
      mtnNumber: "46733123458",
      scenario: "REQUEST_TO_PAY_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237600000459@cameroon": {
      mtnNumber: "46733123459",
      scenario: "REQUEST_TO_PAY_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237600000459": {
      mtnNumber: "46733123459",
      scenario: "REQUEST_TO_PAY_PAYER_INVALID_CALLBACK_URL_HOST",
    },
    "237600000460@cameroon": {
      mtnNumber: "46733123460",
      scenario: "REQUEST_TO_PAY_PAYER_INVALID_CURRENCY",
    },
    "237600000460": {
      mtnNumber: "46733123460",
      scenario: "REQUEST_TO_PAY_PAYER_INVALID_CURRENCY",
    },
    "237600000461@cameroon": {
      mtnNumber: "46733123461",
      scenario: "REQUEST_TO_PAY_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237600000461": {
      mtnNumber: "46733123461",
      scenario: "REQUEST_TO_PAY_PAYER_INTERNAL_PROCESSING_ERROR",
    },
    "237600000462@cameroon": {
      mtnNumber: "46733123462",
      scenario: "REQUEST_TO_PAY_PAYER_SERVICE_UNAVAILABLE",
    },
    "237600000462": {
      mtnNumber: "46733123462",
      scenario: "REQUEST_TO_PAY_PAYER_SERVICE_UNAVAILABLE",
    },
    "237600000463@cameroon": {
      mtnNumber: "46733123463",
      scenario: "REQUEST_TO_PAY_COULD_NOT_PERFORM_TRANSACTION",
    },
    "237600000463": {
      mtnNumber: "46733123463",
      scenario: "REQUEST_TO_PAY_COULD_NOT_PERFORM_TRANSACTION",
    },

    // FlowPay Refund Test Scenarios (237650000XXX) || MTN Refund Test Numbers
    "237650000001@cameroon": {
      mtnNumber: "46733999999",
      scenario: "REFUND_TRANSACTION_NOT_FOUND",
    },
    "237650000001": {
      mtnNumber: "46733999999",
      scenario: "REFUND_TRANSACTION_NOT_FOUND",
    },
    "237650000002@cameroon": {
      mtnNumber: "46733123450",
      scenario: "REFUND_TRANSACTION_FAILED",
    },
    "237650000002": {
      mtnNumber: "46733123450",
      scenario: "REFUND_TRANSACTION_FAILED",
    },
    "237650000003@cameroon": {
      mtnNumber: "46733123451",
      scenario: "REFUND_TRANSACTION_REJECTED",
    },
    "237650000003": {
      mtnNumber: "46733123451",
      scenario: "REFUND_TRANSACTION_REJECTED",
    },
    "237650000004@cameroon": {
      mtnNumber: "46733123452",
      scenario: "REFUND_TRANSACTION_EXPIRED",
    },
    "237650000004": {
      mtnNumber: "46733123452",
      scenario: "REFUND_TRANSACTION_EXPIRED",
    },
    "237650000005@cameroon": {
      mtnNumber: "46733123453",
      scenario: "REFUND_TRANSACTION_ONGOING",
    },
    "237650000005": {
      mtnNumber: "46733123453",
      scenario: "REFUND_TRANSACTION_ONGOING",
    },
    "237650000006@cameroon": {
      mtnNumber: "46733123454",
      scenario: "REFUND_TRANSACTION_DELAYED",
    },
    "237650000006": {
      mtnNumber: "46733123454",
      scenario: "REFUND_TRANSACTION_DELAYED",
    },
    "237650000007@cameroon": {
      mtnNumber: "46733123457",
      scenario: "REFUND_TRANSACTION_NOT_ALLOWED",
    },
    "237650000007": {
      mtnNumber: "46733123457",
      scenario: "REFUND_TRANSACTION_NOT_ALLOWED",
    },
    "237650000008@cameroon": {
      mtnNumber: "46733123458",
      scenario: "REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237650000008": {
      mtnNumber: "46733123458",
      scenario: "REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT",
    },
    "237650000009@cameroon": {
      mtnNumber: "46733123459",
      scenario: "REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST",
    },
    "237650000009": {
      mtnNumber: "46733123459",
      scenario: "REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST",
    },
    "237650000010@cameroon": {
      mtnNumber: "46733123460",
      scenario: "REFUND_TRANSACTION_INVALID_CURRENCY",
    },
    "237650000010": {
      mtnNumber: "46733123460",
      scenario: "REFUND_TRANSACTION_INVALID_CURRENCY",
    },
    "237650000011@cameroon": {
      mtnNumber: "46733123461",
      scenario: "REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR",
    },
    "237650000011": {
      mtnNumber: "46733123461",
      scenario: "REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR",
    },
    "237650000012@cameroon": {
      mtnNumber: "46733123462",
      scenario: "REFUND_TRANSACTION_SERVICE_UNAVAILABLE",
    },
    "237650000012": {
      mtnNumber: "46733123462",
      scenario: "REFUND_TRANSACTION_SERVICE_UNAVAILABLE",
    },
    "237650000013@cameroon": {
      mtnNumber: "46733123463",
      scenario: "REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION",
    },
    "237650000013": {
      mtnNumber: "46733123463",
      scenario: "REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION",
    },
  };

  /**
   * Store raw provider response for debugging and audit purposes
   */
  private async storeRawResponse(
    operation: string,
    request: any,
    response: Response,
    responseData?: any
  ): Promise<{
    request: any;
    response: {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      data?: any;
      rawText?: string;
    };
    timestamp: string;
  }> {
    const rawResponse = {
      request,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
        rawText: responseData
          ? undefined
          : await response.text().catch(() => "Failed to read response"),
      },
      timestamp: new Date().toISOString(),
    };

    logger.info(
      {
        operation,
        status: response.status,
        hasData: !!responseData,
        requestSize: JSON.stringify(request).length,
        responseSize: responseData
          ? JSON.stringify(responseData).length
          : rawResponse.response.rawText?.length || 0,
      },
      "Stored raw provider response"
    );

    return rawResponse;
  }

  /**
   * Map FlowPay test numbers to MTN sandbox test numbers for testing scenarios
   */
  private mapTestNumber(flowPayNumber: string, transactionId?: string): string {
    // Only apply mapping in sandbox environment
    if (this.targetEnvironment !== "sandbox") {
      return flowPayNumber;
    }

    const mapping =
      MTNMobileMoneyProvider.FLOWPAY_TEST_NUMBER_MAPPING[flowPayNumber];
    if (mapping) {
      logger.info(
        {
          flowPayNumber,
          mtnNumber: mapping.mtnNumber,
          scenario: mapping.scenario,
        },
        "Mapping FlowPay test number to MTN sandbox test number"
      );

      return mapping.mtnNumber;
    }

    // If no mapping found but transaction ID indicates test scenario, use appropriate test number
    if (transactionId) {
      if (transactionId.includes("failed_test")) {
        logger.info(
          {
            flowPayNumber,
            transactionId,
            mapped: "46733123450",
            scenario: "FAILED",
          },
          "Using FAILED test MSISDN based on transaction ID"
        );
        return "46733123450"; // Failed test number
      }

      if (transactionId.includes("rejected_test")) {
        logger.info(
          {
            flowPayNumber,
            transactionId,
            mapped: "46733123451",
            scenario: "REJECTED",
          },
          "Using REJECTED test MSISDN based on transaction ID"
        );
        return "46733123451"; // Rejected test number
      }

      if (transactionId.includes("timeout_test")) {
        logger.info(
          {
            flowPayNumber,
            transactionId,
            mapped: "46733123452",
            scenario: "TIMEOUT",
          },
          "Using TIMEOUT test MSISDN based on transaction ID"
        );
        return "46733123452"; // Timeout test number
      }

      if (transactionId.includes("pending_test")) {
        logger.info(
          {
            flowPayNumber,
            transactionId,
            mapped: "46733123454",
            scenario: "PENDING",
          },
          "Using PENDING test MSISDN based on transaction ID"
        );
        return "46733123454"; // Pending test number
      }

      if (transactionId.includes("delayed_success_test")) {
        logger.info(
          {
            flowPayNumber,
            transactionId,
            mapped: "46733123454",
            scenario: "DELAYED_SUCCESS",
          },
          "Using DELAYED_SUCCESS test MSISDN based on transaction ID"
        );
        return "46733123454"; // Delayed success test number
      }

      if (
        transactionId.includes("success_test") ||
        transactionId.includes("completed_test")
      ) {
        logger.info(
          {
            flowPayNumber,
            transactionId,
            mapped: "56733123453",
            scenario: "SUCCESS",
          },
          "Using SUCCESS test MSISDN based on transaction ID"
        );
        return "56733123453"; // Success test number
      }
    }

    // If no mapping found, return original number (strip @cameroon suffix for MTN)
    return flowPayNumber.replace("@cameroon", "");
  }

  /**
   * Get test scenario information for a FlowPay test number
   */
  public static getTestScenario(
    flowPayNumber: string
  ): { scenario: string; description: string } | null {
    const mapping =
      MTNMobileMoneyProvider.FLOWPAY_TEST_NUMBER_MAPPING[flowPayNumber];
    if (!mapping) return null;

    const descriptions: Record<string, string> = {
      IMMEDIATE_SUCCESS: "Transaction will succeed immediately",
      ONGOING: "Transaction is ongoing/in progress",
      DELAYED_SUCCESS:
        "Transaction will be pending initially, then succeed after ~30 seconds",

      // PreApproval Scenarios
      PAYMENT_PREAPPROVAL_PAYER_FAILED:
        "Payment PreApproval: Payer failed (insufficient funds/authorization)",
      PAYMENT_PREAPPROVAL_PAYEE_DECLINED:
        "Payment PreApproval: Payee declined the transaction",
      PAYMENT_PREAPPROVAL_TIMEOUT:
        "Payment PreApproval: Timeout during approval process",
      PAYMENT_PREAPPROVAL_EXPIRED:
        "Payment PreApproval: Approval window expired",
      PAYMENT_PREAPPROVAL_PENDING:
        "Payment PreApproval: Pending approval state",
      PAYMENT_INSUFFICIENT_FUNDS: "Payment: Insufficient funds",
      PAYMENT_PAYEE_NOT_ALLOWED_TO_RECEIVE:
        "Payment: Payee not allowed to receive",
      PAYMENT_PAYER_NOT_ALLOWED: "Payment: Payer not allowed",
      PAYMENT_NOT_ALLOWED_TARGET_ENVIRONMENT:
        "Payment: Not allowed in target environment",
      PAYMENT_INVALID_CALLBACK_URL_HOST: "Payment: Invalid callback URL host",

      // Transfer Scenarios
      TRANSFER_PAYEE_FAILED:
        "Transfer: Payee failed (insufficient funds/authorization)",
      TRANSFER_PAYEE_REJECTED: "Transfer: Payee rejected the transaction",
      TRANSFER_PAYEE_EXPIRED: "Transfer: Payee request expired",
      TRANSFER_PAYEE_ONGOING: "Transfer: Payee transaction ongoing",
      TRANSFER_PAYEE_DELAYED: "Transfer: Payee transaction delayed",
      TRANSFER_PAYEE_NOT_ENOUGH_FUNDS: "Transfer: Not enough funds",
      TRANSFER_PAYEE_PAYER_LIMIT_REACHED: "Transfer: Payer limit reached",
      TRANSFER_PAYEE_NOT_FOUND: "Transfer: Payee not found",
      TRANSFER_PAYEE_NOT_ALLOWED: "Transfer: Payee not allowed",
      TRANSFER_PAYEE_NOT_ALLOWED_TARGET_ENVIRONMENT:
        "Transfer: Not allowed in target environment",
      TRANSFER_PAYEE_INVALID_CALLBACK_URL_HOST:
        "Transfer: Invalid callback URL host",
      TRANSFER_PAYEE_INVALID_CURRENCY: "Transfer: Invalid currency",
      TRANSFER_PAYEE_INTERNAL_PROCESSING_ERROR:
        "Transfer: Internal processing error",
      TRANSFER_PAYEE_SERVICE_UNAVAILABLE: "Transfer: Service unavailable",

      // Deposit Scenarios
      DEPOSIT_PAYER_FAILED:
        "Deposit: Payer failed (insufficient funds/authorization)",
      DEPOSIT_PAYER_REJECTED: "Deposit: Payer rejected the transaction",
      DEPOSIT_PAYER_EXPIRED: "Deposit: Payer request expired",
      DEPOSIT_PAYER_ONGOING: "Deposit: Payer transaction ongoing",
      DEPOSIT_PAYER_DELAYED: "Deposit: Payer transaction delayed",
      DEPOSIT_PAYER_NOT_FOUND: "Deposit: Payer not found",
      DEPOSIT_PAYER_PAYEE_NOT_ALLOWED_TO_RECEIVE:
        "Deposit: Payee not allowed to receive",
      DEPOSIT_PAYER_NOT_ALLOWED: "Deposit: Payer not allowed",
      DEPOSIT_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT:
        "Deposit: Payer not allowed in target environment",
      DEPOSIT_PAYER_INVALID_CALLBACK_URL_HOST:
        "Deposit: Invalid callback URL host",
      DEPOSIT_PAYER_INVALID_CURRENCY: "Deposit: Invalid currency",
      DEPOSIT_PAYER_INTERNAL_PROCESSING_ERROR:
        "Deposit: Internal processing error",
      DEPOSIT_PAYER_SERVICE_UNAVAILABLE: "Deposit: Service unavailable",
      DEPOSIT_PAYER_COULD_NOT_PERFORM_TRANSACTION:
        "Deposit: Could not perform transaction",

      // PreApproval API Scenarios
      PREAPPROVAL_PAYER_FAILED:
        "PreApproval API: Payer failed to complete authorization",
      PREAPPROVAL_PAYER_REJECTED:
        "PreApproval API: Payer rejected the authorization request",
      PREAPPROVAL_PAYER_EXPIRED:
        "PreApproval API: Authorization request expired",
      PREAPPROVAL_PAYER_ONGOING:
        "PreApproval API: Authorization is ongoing/in progress",
      PREAPPROVAL_PAYER_DELAYED:
        "PreApproval API: Authorization is delayed but will complete",
      PREAPPROVAL_PAYER_NOT_FOUND: "PreApproval API: Payer account not found",
      PREAPPROVAL_PAYER_NOT_ALLOWED:
        "PreApproval API: Payer not allowed to authorize",
      PREAPPROVAL_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT:
        "PreApproval API: Not allowed in target environment",
      PREAPPROVAL_PAYER_INVALID_CALLBACK_URL_HOST:
        "PreApproval API: Invalid callback URL host",
      PREAPPROVAL_PAYER_INVALID_CURRENCY:
        "PreApproval API: Invalid or unsupported currency",
      PREAPPROVAL_PAYER_INTERNAL_PROCESSING_ERROR:
        "PreApproval API: Internal processing error",
      PREAPPROVAL_PAYER_SERVICE_UNAVAILABLE:
        "PreApproval API: Service temporarily unavailable",

      // Request-to-Pay Scenarios
      REQUEST_TO_PAY_PAYER_FAILED:
        "Request-to-Pay: Payer failed to complete payment",
      REQUEST_TO_PAY_PAYER_REJECTED:
        "Request-to-Pay: Payer rejected the payment request",
      REQUEST_TO_PAY_PAYER_EXPIRED: "Request-to-Pay: Payment request expired",
      REQUEST_TO_PAY_PAYER_ONGOING:
        "Request-to-Pay: Payment is ongoing/in progress",
      REQUEST_TO_PAY_PAYER_DELAYED:
        "Request-to-Pay: Payment is delayed but will complete",
      REQUEST_TO_PAY_PAYER_NOT_FOUND: "Request-to-Pay: Payer account not found",
      REQUEST_TO_PAY_PAYEE_NOT_ALLOWED_TO_RECEIVE:
        "Request-to-Pay: Payee not allowed to receive payments",
      REQUEST_TO_PAY_PAYER_NOT_ALLOWED:
        "Request-to-Pay: Payer not allowed to make payments",
      REQUEST_TO_PAY_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT:
        "Request-to-Pay: Not allowed in target environment",
      REQUEST_TO_PAY_PAYER_INVALID_CALLBACK_URL_HOST:
        "Request-to-Pay: Invalid callback URL host",
      REQUEST_TO_PAY_PAYER_INVALID_CURRENCY:
        "Request-to-Pay: Invalid or unsupported currency",
      REQUEST_TO_PAY_PAYER_INTERNAL_PROCESSING_ERROR:
        "Request-to-Pay: Internal processing error",
      REQUEST_TO_PAY_PAYER_SERVICE_UNAVAILABLE:
        "Request-to-Pay: Service temporarily unavailable",
      REQUEST_TO_PAY_COULD_NOT_PERFORM_TRANSACTION:
        "Request-to-Pay: Could not perform the transaction",
    };

    return {
      scenario: mapping.scenario,
      description: descriptions[mapping.scenario] || "Unknown scenario",
    };
  }

  private getSubscriptionKey(
    productType: "collection" | "disbursement" | "remittance" = "collection"
  ): string {
    switch (productType) {
      case "collection":
        return this.collectionSubscriptionKey;
      case "disbursement":
        return this.disbursementSubscriptionKey;
      case "remittance":
        return this.remittanceSubscriptionKey;
      default:
        return this.collectionSubscriptionKey;
    }
  }

  private async getAccessToken(
    productType: "collection" | "disbursement" | "remittance" = "collection"
  ): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    try {
      // Use separate API users for collection and disbursement
      const apiUser =
        productType === "disbursement"
          ? process.env.MTN_DISBURSEMENT_API_USER || this.apiUser
          : this.apiUser;
      const apiSecret =
        productType === "disbursement"
          ? process.env.MTN_DISBURSEMENT_API_SECRET || this.apiSecret
          : this.apiSecret;

      const auth = Buffer.from(`${apiUser}:${apiSecret}`).toString("base64");

      const subscriptionKey = this.getSubscriptionKey(productType);

      logger.info(
        {
          url: `${this.baseUrl}/${productType}/token/`,
          productType,
          hasApiUser: !!apiUser,
          hasApiSecret: !!apiSecret,
          hasSubscriptionKey: !!subscriptionKey,
          targetEnvironment: this.targetEnvironment,
          apiUser: apiUser,
          authHeader: `Basic ${auth}`,
          subscriptionKey: subscriptionKey,
        },
        "Requesting MTN access token"
      );

      const response = await fetch(`${this.baseUrl}/${productType}/token/`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Ocp-Apim-Subscription-Key": subscriptionKey,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            errorBody,
            headers: Object.fromEntries(response.headers.entries()),
          },
          "MTN token request failed"
        );
        throw new Error(
          `Failed to get MTN access token: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      const data = (await response.json()) as MTNAuthToken;

      this.accessToken = data.access_token;
      this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000); // Refresh 1 minute before expiry

      logger.info(
        {
          access_token: data.access_token,
          token_type: data.token_type,
          expires_in: data.expires_in,
          expiry_time: this.tokenExpiry.toISOString(),
        },
        "MTN access token refreshed successfully"
      );
      return this.accessToken;
    } catch (error) {
      logger.error({ error }, "Failed to get MTN access token");
      throw error;
    }
  }

  private formatPhoneNumber(phone: string): string {
    // In sandbox mode, use comprehensive FlowPay test number mapping
    if (this.targetEnvironment === "sandbox") {
      // Check if this is a FlowPay test number that should be mapped
      const mapping = MTNMobileMoneyProvider.FLOWPAY_TEST_NUMBER_MAPPING[phone];
      if (mapping) {
        logger.info(
          {
            original: phone,
            mapped: mapping.mtnNumber,
            scenario: mapping.scenario,
          },
          "Using comprehensive FlowPay test number mapping"
        );
        return mapping.mtnNumber;
      }

      // Extract just the numeric part for non-mapped numbers
      const cleaned = phone.replace(/@cameroon$/, "").replace(/\D/g, "");

      // For backwards compatibility with existing test patterns
      const lastDigit = cleaned.slice(-1);
      const basicMSISDNs: { [key: string]: string } = {
        "0": "46733123450", // Failed
        "1": "46733123451", // Rejected
        "2": "46733123452", // Timeout
        "3": "56733123453", // Success
        "4": "46733123454", // Pending
      };

      if (cleaned.length <= 10 && basicMSISDNs[lastDigit]) {
        logger.info(
          { original: phone, mapped: basicMSISDNs[lastDigit] },
          "Using basic test MSISDN mapping"
        );
        return basicMSISDNs[lastDigit];
      }

      logger.info(
        { original: phone },
        "No test mapping found, using cleaned phone number"
      );
      return cleaned;
    }

    // Production mode - handle real phone numbers
    // Remove @cameroon suffix and any non-digit characters
    const cleaned = phone.replace(/@cameroon$/, "").replace(/\D/g, "");

    // Remove country code if present
    if (cleaned.startsWith("237")) {
      return cleaned.substring(3);
    }

    return cleaned;
  }

  async initiatePayment(params: PaymentRequest): Promise<PaymentResponse> {
    try {
      const accessToken = await this.getAccessToken("collection");
      const referenceId = crypto.randomUUID();

      // Use EUR for sandbox, XAF for production (Cameroon)
      const currency =
        this.targetEnvironment === "sandbox" ? "EUR" : params.currency || "XAF";

      // Branch: MTN Collection v2.0 payment
      if (params.providerMode === 'mtn-v2') {
        const v2 = params.providerOptions?.mtnV2 || params.providerOptions || {};

        // Build v2 payment request body
        const v2Body = {
          externalTransactionId: v2.externalTransactionId || params.transactionId,
          money: {
            amount: params.amount.toString(),
            currency: currency,
          },
          customerReference: v2.customerReference || this.formatPhoneNumber(this.mapTestNumber(params.from, params.transactionId)),
          serviceProviderUserName: v2.serviceProviderUserName,
          couponId: v2.couponId,
          productId: v2.productId,
          productOfferingId: v2.productOfferingId,
          receiverMessage: v2.receiverMessage || params.description || `Payment from ${params.from}`,
          senderNote: v2.senderNote || '',
          maxNumberOfRetries: v2.maxNumberOfRetries,
          includeSenderCharges: v2.includeSenderCharges,
        } as any;

        const headers: any = {
          Authorization: `Bearer ${accessToken}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": this.targetEnvironment,
          "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
          "Content-Type": "application/json",
        };

        // Add callback URL when allowed
        if ((this.targetEnvironment === 'sandbox' && (this.callbackUrl.includes('webhook.site') || this.callbackUrl.includes('ngrok'))) || this.targetEnvironment === 'production') {
          headers["X-Callback-Url"] = this.callbackUrl;
        }

        logger.info({ referenceId, v2Body }, 'Sending MTN v2 payment request');

        const resp = await fetch(`${this.baseUrl}/collection/v2_0/payment`, {
          method: 'POST',
          headers,
          body: JSON.stringify(v2Body),
        });

        logger.info({ referenceId, status: resp.status, statusText: resp.statusText }, 'MTN v2 payment response');

        if (resp.status === 202) {
          // Short wait then status check v2
          await new Promise(r => setTimeout(r, 2000));
          const status = await this.checkStatusV2(referenceId);

          return {
            success: true,
            providerTransactionId: referenceId,
            originalRequestReference: referenceId,
            status: status.status,
            message: 'Payment initiated successfully (v2)',
            timestamp: new Date(),
            financialTransactionId: status.financialTransactionId,
            rawProviderResponse: { request: v2Body, responseStatus: resp.status },
          };
        } else {
          const text = await resp.text();
          logger.error({ referenceId, status: resp.status, text }, 'MTN v2 payment initiation failed');
          return {
            success: false,
            providerTransactionId: referenceId,
            status: PaymentStatusEnum.FAILED,
            message: `Payment initiation failed (v2): ${text}`,
            timestamp: new Date(),
          };
        }
      }

      // Default branch: MTN Collection v1.0 requesttopay
      const mtnRequest: MTNPaymentRequest = {
        amount: params.amount.toString(),
        currency: currency,
        externalId: params.transactionId,
        payer: {
          partyIdType: "MSISDN",
          partyId: this.formatPhoneNumber(
            this.mapTestNumber(params.from, params.transactionId)
          ),
        },
        payerMessage: params.description || `Payment to ${params.to}`,
        payeeNote: `Payment from ${params.from}`,
      };

      // For sandbox, only include callback URL if it matches the configured host
      const headers: any = {
        Authorization: `Bearer ${accessToken}`,
        "X-Reference-Id": referenceId,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
        "Content-Type": "application/json",
      };

      // Add callback URL for webhooks
      if (
        this.targetEnvironment === "sandbox" &&
        (this.callbackUrl.includes("webhook.site") ||
          this.callbackUrl.includes("ngrok"))
      ) {
        headers["X-Callback-Url"] = this.callbackUrl;
        logger.info(
          { callbackUrl: this.callbackUrl },
          "Adding webhook callback URL for sandbox"
        );
      } else if (this.targetEnvironment === "production") {
        headers["X-Callback-Url"] = this.callbackUrl;
        logger.info(
          { callbackUrl: this.callbackUrl },
          "Adding webhook callback URL for production"
        );
      } else {
        logger.info(
          {
            callbackUrl: this.callbackUrl,
            environment: this.targetEnvironment,
          },
          "Webhook callback URL not added - unsupported URL or environment"
        );
      }

      logger.info(
        {
          referenceId,
          request: mtnRequest,
          headers: {
            "X-Reference-Id": referenceId,
            "X-Target-Environment": this.targetEnvironment,
            hasCallback: "X-Callback-Url" in headers,
          },
        },
        "Sending MTN request-to-pay"
      );

      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(mtnRequest),
        }
      );

      // Store raw response for audit and debugging
      let rawResponseData: any;
      if (response.status === 202) {
        rawResponseData = await this.storeRawResponse(
          "requesttopay",
          mtnRequest,
          response
        );
      } else {
        const errorText = await response.text();
        rawResponseData = await this.storeRawResponse(
          "requesttopay",
          mtnRequest,
          response,
          { error: errorText }
        );
      }

      logger.info(
        {
          referenceId,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        },
        "MTN request-to-pay response"
      );

      if (response.status === 202) {
        // Payment request accepted, now check status
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before checking

        const status = await this.checkStatus(referenceId);

        logger.info(
          {
            referenceId,
            paymentStatus: status,
          },
          "MTN payment status after check"
        );

        return {
          success: true,
          providerTransactionId: referenceId,
          originalRequestReference: referenceId, // Store the X-Reference-Id for refunds
          status: status.status,
          message: "Payment initiated successfully",
          timestamp: new Date(),
          financialTransactionId: status.financialTransactionId, // Include MTN's financial transaction ID
          rawProviderResponse: rawResponseData,
        };
      } else {
        logger.error(
          {
            statusCode: response.status,
            error: rawResponseData.response.data?.error,
          },
          "MTN payment initiation failed"
        );

        return {
          success: false,
          providerTransactionId: referenceId,
          status: PaymentStatusEnum.FAILED,
          message: `Payment initiation failed: ${
            rawResponseData.response.data?.error || "Unknown error"
          }`,
          timestamp: new Date(),
          rawProviderResponse: rawResponseData,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN payment initiation error");

      return {
        success: false,
        providerTransactionId: "",
        status: PaymentStatusEnum.FAILED,
        message: error.message,
        timestamp: new Date(),
      };
    }
  }

  async checkStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const accessToken = await this.getAccessToken("collection");

      const statusUrl = `${this.baseUrl}/collection/v1_0/requesttopay/${transactionId}`;

      logger.info(
        {
          transactionId,
          statusUrl,
          targetEnvironment: this.targetEnvironment,
          collectionSubscriptionKey: this.collectionSubscriptionKey,
        },
        "Checking MTN payment status"
      );

      const response = await fetch(statusUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Target-Environment": this.targetEnvironment,
          "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
        },
      });

      logger.info(
        {
          transactionId,
          responseStatus: response.status,
          responseStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        },
        "MTN status check response received"
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            transactionId,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          },
          "Failed to check MTN payment status"
        );
        throw new Error(
          `Failed to check payment status: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as MTNPaymentStatus;

      logger.info(
        {
          transactionId,
          mtnResponse: data,
        },
        "MTN payment status response"
      );

      let status: PaymentStatusEnum;
      switch (data.status) {
        case "SUCCESSFUL":
          status = PaymentStatusEnum.COMPLETED;
          break;
        case "FAILED":
        case "REJECTED":
        case "APPROVAL_REJECTED":
        case "CANCELLED":
          status = PaymentStatusEnum.FAILED;
          break;
        case "PENDING":
        default:
          status = PaymentStatusEnum.PENDING;
      }

      return {
        transactionId: data.externalId,
        providerTransactionId: transactionId,
        status,
        amount: parseFloat(data.amount),
        currency: data.currency, // Include currency from MTN response
        completedAt:
          status === PaymentStatusEnum.COMPLETED ? new Date() : undefined,
        failureReason: data.reason,
        financialTransactionId: data.financialTransactionId, // Include MTN's financial transaction ID
      };
    } catch (error: any) {
      logger.error(
        { error, transactionId },
        "Failed to check MTN payment status"
      );

      return {
        transactionId,
        providerTransactionId: transactionId,
        status: PaymentStatusEnum.FAILED,
        amount: 0,
        failureReason: error.message,
      };
    }
  }

  // MTN Collection v2.0 status check for payment
  async checkStatusV2(referenceId: string): Promise<PaymentStatus> {
    try {
      const accessToken = await this.getAccessToken('collection');

      const url = `${this.baseUrl}/collection/v2_0/payment/${referenceId}`;
      logger.info({ referenceId, url }, 'Checking MTN v2 payment status');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Target-Environment': this.targetEnvironment,
          'Ocp-Apim-Subscription-Key': this.collectionSubscriptionKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to check v2 payment status: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as any;
      logger.info({ referenceId, mtnV2Response: data }, 'MTN v2 payment status response');

      let status: PaymentStatusEnum;
      switch (data.status) {
        case 'SUCCESSFUL':
          status = PaymentStatusEnum.COMPLETED; break;
        case 'FAILED':
        case 'REJECTED':
        case 'APPROVAL_REJECTED':
        case 'CANCELLED':
          status = PaymentStatusEnum.FAILED; break;
        case 'PENDING':
        default:
          status = PaymentStatusEnum.PENDING;
      }

      return {
        transactionId: data.externalTransactionId || data.externalId || referenceId,
        providerTransactionId: referenceId,
        status,
        amount: parseFloat(data?.money?.amount || data.amount || '0'),
        currency: data?.money?.currency || data.currency,
        completedAt: status === PaymentStatusEnum.COMPLETED ? new Date() : undefined,
        failureReason: data.reason,
        financialTransactionId: data.financialTransactionId,
      };
    } catch (error: any) {
      logger.error({ error, referenceId }, 'Failed to check MTN v2 payment status');
      return {
        transactionId: referenceId,
        providerTransactionId: referenceId,
        status: PaymentStatusEnum.FAILED,
        amount: 0,
        failureReason: error.message,
      };
    }
  }

  async refund(
    transactionId: string,
    amount?: number
  ): Promise<RefundResponse> {
    try {
      // Get the original payment details from MTN
      logger.info(
        {
          transactionId,
          requestedAmount: amount,
          targetEnvironment: this.targetEnvironment,
        },
        "Starting MTN refund process - checking original payment"
      );

      const originalPayment = await this.checkStatus(transactionId);

      logger.info(
        {
          transactionId,
          originalPaymentFound: !!originalPayment,
          originalPaymentStatus: originalPayment?.status,
          originalPaymentAmount: originalPayment?.amount,
        },
        "MTN original payment check result"
      );

      if (
        !originalPayment ||
        originalPayment.status !== PaymentStatusEnum.COMPLETED
      ) {
        logger.error(
          {
            transactionId,
            originalPayment,
            expectedStatus: PaymentStatusEnum.COMPLETED,
          },
          "MTN refund failed - original payment not found or not completed"
        );

        const errorCode = !originalPayment
          ? RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND
          : RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED;

        const errorDetails = createRefundError(
          errorCode,
          undefined,
          transactionId,
          "PAYMENT_NOT_ELIGIBLE",
          "Original payment not found or not completed"
        );

        return {
          success: false,
          refundId: "",
          amount: 0,
          status: RefundStatusEnum.FAILED,
          message: errorDetails.message,
          errorCode: errorDetails.code,
          errorDetails: {
            code: errorDetails.code,
            message: errorDetails.message,
            providerErrorCode: errorDetails.providerErrorCode,
            providerErrorMessage: errorDetails.providerErrorMessage,
            retryable: errorDetails.retryable,
          },
        };
      }

      const refundAmount = amount || originalPayment.amount;
      const refundReferenceId = `refund_${Date.now()}_${crypto
        .randomUUID()
        .substring(0, 8)}`;
      const accessToken = await this.getAccessToken("disbursement"); // Note: using disbursement

      logger.info(
        {
          accessTokenLength: accessToken.length,
          accessTokenPrefix: accessToken.substring(0, 50),
          tokenType: "disbursement",
        },
        "Got disbursement access token for refund"
      );

      const refundRequest = {
        amount: refundAmount.toString(),
        currency: this.targetEnvironment === "sandbox" ? "EUR" : "XAF",
        externalId: refundReferenceId, // Use unique refund ID as external ID
        payerMessage: "Refund for MoMo Market Payment",
        payeeNote: "Refund for your payment",
        referenceIdToRefund: transactionId, // This is the MTN reference from original payment
      };

      logger.info(
        {
          refundReferenceId,
          refundRequest,
          originalTransactionId: transactionId,
          originalPaymentAmount: originalPayment.amount,
          disbursementUrl: `${this.baseUrl}/disbursement/v1_0/refund`,
          disbursementSubscriptionKey: this.disbursementSubscriptionKey,
          targetEnvironment: this.targetEnvironment,
          accessToken: accessToken.substring(0, 20) + "...",
        },
        "Initiating MTN refund request"
      );

      // Build headers - omit X-Callback-Url for refunds as it might cause issues with localhost
      const headers: any = {
        Authorization: `Bearer ${accessToken}`,
        "X-Reference-Id": refundReferenceId,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
        "Content-Type": "application/json",
      };

      // Don't include callback URL for refunds in sandbox (causes 400 error with localhost)
      // Uncomment for production with valid public URL
      // if (this.callbackUrl && !this.callbackUrl.includes('localhost')) {
      //   headers['X-Callback-Url'] = this.callbackUrl;
      // }

      logger.info(
        {
          refundReferenceId,
          headers: {
            ...headers,
            Authorization: `Bearer ${accessToken.substring(0, 20)}...`, // Mask token for logs
          },
          body: refundRequest,
          note: "X-Callback-Url omitted for sandbox localhost",
        },
        "MTN refund request headers and body"
      );

      // NOTE: MTN refund API is known to return 400 in sandbox environment
      // Multiple developers report this issue: https://momodevelopercommunity.mtn.com/momo-api-sand-box-q-a-6
      // This should work in production environment

      // Log the exact request being sent
      const requestBody = JSON.stringify(refundRequest);
      const requestUrl = `${this.baseUrl}/disbursement/v2_0/refund`;

      logger.info(
        {
          url: requestUrl,
          method: "POST",
          headers: {
            ...headers,
            Authorization: `Bearer ${accessToken.substring(
              0,
              30
            )}...${accessToken.substring(accessToken.length - 10)}`,
          },
          bodyLength: requestBody.length,
          body: requestBody,
        },
        "Sending exact refund request to MTN"
      );

      // Try v2.0 endpoint first, then fallback to v1.0
      let response = await fetch(requestUrl, {
        method: "POST",
        headers,
        body: requestBody,
      });

      logger.info(
        {
          refundReferenceId,
          responseStatus: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          endpoint: "v2_0/refund",
        },
        "MTN refund API v2.0 response received"
      );

      // If v2.0 fails, try v1.0 as fallback
      if (response.status === 400 || response.status === 404) {
        logger.info({ refundReferenceId }, "v2.0 failed, trying v1.0 fallback");

        response = await fetch(`${this.baseUrl}/disbursement/v1_0/refund`, {
          method: "POST",
          headers,
          body: JSON.stringify(refundRequest),
        });

        logger.info(
          {
            refundReferenceId,
            responseStatus: response.status,
            responseHeaders: Object.fromEntries(response.headers.entries()),
            endpoint: "v1_0/refund",
          },
          "MTN refund API v1.0 fallback response received"
        );
      }

      // Store raw response for audit and debugging
      let rawResponseData: any;
      if (response.status === 202) {
        rawResponseData = await this.storeRawResponse(
          "refund",
          refundRequest,
          response
        );

        // Refund request accepted
        logger.info({ refundReferenceId }, "MTN refund request accepted");

        // Wait a bit then check status
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const refundStatus = await this.checkRefundStatus(refundReferenceId);

        logger.info(
          {
            refundReferenceId,
            refundStatusResult: refundStatus,
          },
          "MTN refund status check completed"
        );

        return {
          success: true,
          refundId: refundReferenceId,
          amount: refundAmount,
          status: refundStatus.status,
          message: "Refund initiated successfully",
          financialTransactionId: (refundStatus as any).financialTransactionId,
          rawProviderResponse: rawResponseData,
        };
      } else {
        const error = await response.text();
        rawResponseData = await this.storeRawResponse(
          "refund",
          refundRequest,
          response,
          { error }
        );
        logger.error(
          {
            refundReferenceId,
            statusCode: response.status,
            error,
            responseHeaders: Object.fromEntries(response.headers.entries()),
          },
          "MTN refund request failed"
        );

        // Map HTTP status codes to refund error codes
        let errorCode: RefundTransactionErrorCode;
        switch (response.status) {
          case 400:
            errorCode =
              RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CURRENCY;
            break;
          case 401:
          case 403:
            errorCode =
              RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED;
            break;
          case 404:
            errorCode = RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND;
            break;
          case 409:
            errorCode = RefundTransactionErrorCode.REFUND_TRANSACTION_REJECTED;
            break;
          case 500:
            errorCode =
              RefundTransactionErrorCode.REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR;
            break;
          case 503:
            errorCode =
              RefundTransactionErrorCode.REFUND_TRANSACTION_SERVICE_UNAVAILABLE;
            break;
          default:
            errorCode = RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED;
        }

        const errorDetails = createRefundError(
          errorCode,
          refundReferenceId,
          transactionId,
          response.status.toString(),
          error
        );

        return {
          success: false,
          refundId: refundReferenceId,
          amount: refundAmount,
          status: RefundStatusEnum.FAILED,
          message: errorDetails.message,
          errorCode: errorDetails.code,
          errorDetails: {
            code: errorDetails.code,
            message: errorDetails.message,
            providerErrorCode: errorDetails.providerErrorCode,
            providerErrorMessage: errorDetails.providerErrorMessage,
            retryable: errorDetails.retryable,
          },
        };
      }
    } catch (error: any) {
      logger.error({ error, transactionId, amount }, "MTN refund error");

      const errorDetails = createRefundError(
        RefundTransactionErrorCode.REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION,
        undefined,
        transactionId,
        "NETWORK_ERROR",
        error.message
      );

      return {
        success: false,
        refundId: "",
        amount: amount || 0,
        status: RefundStatusEnum.FAILED,
        message: errorDetails.message,
        errorCode: errorDetails.code,
        errorDetails: {
          code: errorDetails.code,
          message: errorDetails.message,
          providerErrorCode: errorDetails.providerErrorCode,
          providerErrorMessage: errorDetails.providerErrorMessage,
          retryable: errorDetails.retryable,
        },
      };
    }
  }

  async checkRefundStatus(refundId: string): Promise<RefundStatus> {
    try {
      const accessToken = await this.getAccessToken("disbursement");

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/refund/${refundId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to check refund status: ${response.statusText}`
        );
      }

      const data = (await response.json()) as any;

      logger.info(
        {
          refundId,
          mtnResponse: data,
        },
        "MTN refund status response"
      );

      let status: RefundStatusEnum;
      switch (data.status) {
        case "SUCCESSFUL":
          status = RefundStatusEnum.COMPLETED;
          break;
        case "FAILED":
          status = RefundStatusEnum.FAILED;
          break;
        case "PENDING":
        default:
          status = RefundStatusEnum.PENDING;
      }

      return {
        refundId,
        status,
        amount: parseFloat(data.amount),
        completedAt:
          status === RefundStatusEnum.COMPLETED ? new Date() : undefined,
        failureReason: data.reason,
        financialTransactionId: (data as any).financialTransactionId,
      } as any;
    } catch (error: any) {
      logger.error({ error, refundId }, "Failed to check MTN refund status");

      return {
        refundId,
        status: RefundStatusEnum.FAILED,
        amount: 0,
        failureReason: error.message,
      };
    }
  }

  async sendNotification(
    referenceId: string,
    message: string
  ): Promise<NotificationResponse> {
    try {
      const accessToken = await this.getAccessToken("collection");

      // Ensure message doesn't exceed 160 characters
      const truncatedMessage = message.substring(0, 160);

      logger.info(
        {
          referenceId,
          message: truncatedMessage,
        },
        "Sending MTN delivery notification"
      );

      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}/deliverynotification`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            notificationMessage: truncatedMessage,
          }),
        }
      );

      if (response.status === 200 || response.status === 204) {
        logger.info({ referenceId }, "MTN notification sent successfully");
        return {
          success: true,
          message: "Notification sent successfully",
        };
      } else {
        const error = await response.text();
        logger.error(
          { statusCode: response.status, error },
          "MTN notification failed"
        );
        return {
          success: false,
          message: `Notification failed: ${error}`,
        };
      }
    } catch (error: any) {
      logger.error({ error, referenceId, message }, "MTN notification error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async transfer(params: TransferRequest): Promise<TransferResponse> {
    try {
      const accessToken = await this.getAccessToken("disbursement");
      const transferReferenceId = crypto.randomUUID();

      // Use EUR for sandbox, XAF for production
      const currency =
        this.targetEnvironment === "sandbox" ? "EUR" : params.currency || "XAF";

      const transferRequest = {
        amount: params.amount.toString(),
        currency: currency,
        externalId: params.transferId,
        payee: {
          partyIdType: "MSISDN",
          partyId: this.formatPhoneNumber(params.to),
        },
        payerMessage: params.description || `Transfer from FlowPay`,
        payeeNote: `Transfer from ${params.from}`,
      };

      const headers: any = {
        Authorization: `Bearer ${accessToken}`,
        "X-Reference-Id": transferReferenceId,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
        "Content-Type": "application/json",
      };

      // Add callback URL for webhooks
      if (
        this.targetEnvironment === "sandbox" &&
        (this.callbackUrl.includes("webhook.site") ||
          this.callbackUrl.includes("ngrok"))
      ) {
        headers["X-Callback-Url"] = this.callbackUrl;
        logger.info(
          { callbackUrl: this.callbackUrl },
          "Adding webhook callback URL for sandbox transfer"
        );
      } else if (this.targetEnvironment === "production") {
        headers["X-Callback-Url"] = this.callbackUrl;
        logger.info(
          { callbackUrl: this.callbackUrl },
          "Adding webhook callback URL for production transfer"
        );
      } else {
        logger.info(
          {
            callbackUrl: this.callbackUrl,
            environment: this.targetEnvironment,
          },
          "Transfer webhook callback URL not added - unsupported URL or environment"
        );
      }

      logger.info(
        {
          transferReferenceId,
          request: transferRequest,
          targetEnvironment: this.targetEnvironment,
        },
        "Sending MTN transfer request"
      );

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/transfer`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(transferRequest),
        }
      );

      logger.info(
        {
          transferReferenceId,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        },
        "MTN transfer response"
      );

      if (response.status === 202) {
        // Transfer request accepted
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await this.checkTransferStatus(transferReferenceId);

        return {
          success: true,
          transferId: params.transferId,
          providerTransferId: transferReferenceId,
          status: status.status,
          message: "Transfer initiated successfully",
          fee: status.fee,
          timestamp: new Date(),
          financialTransactionId: status.financialTransactionId, // Include MTN's financial transaction ID
          // Raw MTN response data
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          transferStatusDetails: status,
        };
      } else {
        const error = await response.text();
        logger.error(
          { statusCode: response.status, error },
          "MTN transfer initiation failed"
        );

        return {
          success: false,
          transferId: params.transferId,
          providerTransferId: transferReferenceId,
          status: TransferStatusEnum.FAILED,
          message: `Transfer initiation failed: ${error}`,
          timestamp: new Date(),
          // Raw MTN response data
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: error,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN transfer initiation error");

      return {
        success: false,
        transferId: params.transferId,
        providerTransferId: "",
        status: TransferStatusEnum.FAILED,
        message: error.message,
        timestamp: new Date(),
      };
    }
  }

  async checkTransferStatus(transferId: string): Promise<TransferStatus> {
    try {
      const accessToken = await this.getAccessToken("disbursement");

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/transfer/${transferId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            transferId,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          },
          "Failed to check MTN transfer status"
        );
        throw new Error(
          `Failed to check transfer status: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as any;

      logger.info(
        {
          transferId,
          mtnResponse: data,
        },
        "MTN transfer status response"
      );

      let status: TransferStatusEnum;
      switch (data.status) {
        case "SUCCESSFUL":
          status = TransferStatusEnum.COMPLETED;
          break;
        case "FAILED":
          status = TransferStatusEnum.FAILED;
          break;
        case "PENDING":
        default:
          status = TransferStatusEnum.PENDING;
      }

      return {
        transferId: data.externalId,
        providerTransferId: transferId,
        status,
        amount: parseFloat(data.amount),
        completedAt:
          status === TransferStatusEnum.COMPLETED ? new Date() : undefined,
        failureReason: data.reason,
        financialTransactionId: data.financialTransactionId, // Include MTN's financial transaction ID
      };
    } catch (error: any) {
      logger.error(
        { error, transferId },
        "Failed to check MTN transfer status"
      );

      return {
        transferId,
        providerTransferId: transferId,
        status: TransferStatusEnum.FAILED,
        amount: 0,
        failureReason: error.message,
      };
    }
  }

  async getBalance(): Promise<BalanceResponse> {
    try {
      const accessToken = await this.getAccessToken("disbursement");

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/account/balance`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          },
          "Failed to get MTN account balance"
        );
        throw new Error(
          `Failed to get balance: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as any;

      logger.info(
        {
          mtnResponse: data,
        },
        "MTN balance response"
      );

      return {
        success: true,
        balances: [
          {
            currency:
              data.currency ||
              (this.targetEnvironment === "sandbox" ? "EUR" : "XAF"),
            availableBalance: parseFloat(data.availableBalance || "0"),
            accountStatus: data.accountStatus || "ACTIVE",
          },
        ],
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error }, "Failed to get MTN balance");

      return {
        success: false,
        balances: [],
        timestamp: new Date(),
      };
    }
  }

  async validateRecipient(
    accountId: string,
    accountType: string = "MSISDN"
  ): Promise<ValidationResponse> {
    try {
      const accessToken = await this.getAccessToken("disbursement");
      const formattedAccountId = this.formatPhoneNumber(accountId);

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/accountholder/${accountType}/${formattedAccountId}/active`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
          },
        }
      );

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            accountId: formattedAccountId,
            result: data.result,
          },
          "MTN account validation result"
        );

        return {
          success: true,
          isActive: data.result === true,
          message: data.result ? "Account is active" : "Account is not active",
        };
      } else if (response.status === 404) {
        return {
          success: true,
          isActive: false,
          message: "Account not found",
        };
      } else {
        const errorText = await response.text();
        logger.error(
          {
            accountId: formattedAccountId,
            status: response.status,
            errorBody: errorText,
          },
          "MTN account validation failed"
        );

        return {
          success: false,
          isActive: false,
          message: `Validation failed: ${errorText}`,
        };
      }
    } catch (error: any) {
      logger.error({ error, accountId }, "MTN account validation error");

      return {
        success: false,
        isActive: false,
        message: error.message,
      };
    }
  }

  async getUserInfo(
    accountId: string,
    accountType: string = "MSISDN"
  ): Promise<UserInfoResponse> {
    try {
      const accessToken = await this.getAccessToken("disbursement");
      const formattedAccountId = this.formatPhoneNumber(accountId);

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/accountholder/${accountType}/${formattedAccountId}/basicuserinfo`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
          },
        }
      );

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            accountId: formattedAccountId,
            userInfo: data,
          },
          "MTN user info response"
        );

        return {
          success: true,
          userInfo: {
            name: data.name || "",
            given_name: data.given_name,
            family_name: data.family_name,
            birthdate: data.birthdate,
            locale: data.locale,
            gender: data.gender,
            status: data.status,
          },
        };
      } else {
        const errorText = await response.text();
        logger.error(
          {
            accountId: formattedAccountId,
            status: response.status,
            errorBody: errorText,
          },
          "MTN user info request failed"
        );

        return {
          success: false,
          message: `User info request failed: ${errorText}`,
        };
      }
    } catch (error: any) {
      logger.error({ error, accountId }, "MTN user info error");

      return {
        success: false,
        message: error.message,
      };
    }
  }

  async checkDepositStatus(depositId: string): Promise<DepositStatus> {
    try {
      const accessToken = await this.getAccessToken("disbursement");

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/deposit/${depositId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          {
            depositId,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          },
          "Failed to check MTN deposit status"
        );
        throw new Error(
          `Failed to check deposit status: ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as any;

      logger.info(
        {
          depositId,
          mtnResponse: data,
        },
        "MTN deposit status response"
      );

      let status: DepositStatusEnum;
      switch (data.status) {
        case "SUCCESSFUL":
          status = DepositStatusEnum.COMPLETED;
          break;
        case "FAILED":
          status = DepositStatusEnum.FAILED;
          break;
        case "PENDING":
        default:
          status = DepositStatusEnum.PENDING;
      }

      return {
        depositId: data.externalId,
        providerDepositId: depositId,
        status,
        amount: parseFloat(data.amount),
        fee: 0, // MTN doesn't provide fee info in status response
        completedAt:
          status === DepositStatusEnum.COMPLETED ? new Date() : undefined,
        failureReason: data.reason,
        financialTransactionId: data.financialTransactionId,
      };
    } catch (error: any) {
      logger.error({ error, depositId }, "Failed to check MTN deposit status");

      return {
        depositId,
        providerDepositId: depositId,
        status: DepositStatusEnum.FAILED,
        amount: 0,
        fee: 0,
        failureReason: error.message,
      };
    }
  }

  async deposit(params: DepositRequest): Promise<DepositResponse> {
    try {
      const accessToken = await this.getAccessToken("disbursement");
      const depositReferenceId = crypto.randomUUID();

      // Use EUR for sandbox, XAF for production
      const currency =
        this.targetEnvironment === "sandbox" ? "EUR" : params.currency || "XAF";

      const depositRequest = {
        amount: params.amount.toString(),
        currency: currency,
        externalId: params.depositId,
        payee: {
          partyIdType: "MSISDN",
          partyId: this.formatPhoneNumber(params.accountId),
        },
        payerMessage: params.description || `Deposit to account`,
        payeeNote: `Deposit from FlowPay`,
      };

      const headers: any = {
        Authorization: `Bearer ${accessToken}`,
        "X-Reference-Id": depositReferenceId,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.disbursementSubscriptionKey,
        "Content-Type": "application/json",
      };

      // Add callback URL for webhooks
      if (
        this.targetEnvironment === "sandbox" &&
        (this.callbackUrl.includes("webhook.site") ||
          this.callbackUrl.includes("ngrok"))
      ) {
        headers["X-Callback-Url"] = this.callbackUrl;
        logger.info(
          { callbackUrl: this.callbackUrl },
          "Adding webhook callback URL for sandbox deposit"
        );
      } else if (this.targetEnvironment === "production") {
        headers["X-Callback-Url"] = this.callbackUrl;
        logger.info(
          { callbackUrl: this.callbackUrl },
          "Adding webhook callback URL for production deposit"
        );
      } else {
        logger.info(
          {
            callbackUrl: this.callbackUrl,
            environment: this.targetEnvironment,
          },
          "Deposit webhook callback URL not added - unsupported URL or environment"
        );
      }

      // Debug the phone number mapping
      const originalAccountId = params.accountId;
      const mappedPhone = this.formatPhoneNumber(params.accountId);
      const testMapping =
        MTNMobileMoneyProvider.FLOWPAY_TEST_NUMBER_MAPPING[params.accountId];

      logger.info(
        {
          depositReferenceId,
          originalAccountId,
          mappedPhone,
          testMapping,
          request: depositRequest,
          targetEnvironment: this.targetEnvironment,
        },
        "Sending MTN deposit request with phone mapping debug"
      );

      const response = await fetch(
        `${this.baseUrl}/disbursement/v1_0/deposit`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(depositRequest),
        }
      );

      logger.info(
        {
          depositReferenceId,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        },
        "MTN deposit response"
      );

      if (response.status === 202) {
        // Deposit request accepted
        return {
          success: true,
          depositId: params.depositId,
          providerDepositId: depositReferenceId,
          status: DepositStatusEnum.PENDING,
          message: "Deposit initiated successfully",
          timestamp: new Date(),
          // Raw MTN response data
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          requestData: depositRequest,
        };
      } else {
        const error = await response.text();
        logger.error(
          { statusCode: response.status, error },
          "MTN deposit initiation failed"
        );

        return {
          success: false,
          depositId: params.depositId,
          providerDepositId: depositReferenceId,
          status: DepositStatusEnum.FAILED,
          message: `Deposit initiation failed: ${error}`,
          timestamp: new Date(),
          // Raw MTN response data
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: error,
          requestData: depositRequest,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN deposit initiation error");

      return {
        success: false,
        depositId: params.depositId,
        providerDepositId: "",
        status: DepositStatusEnum.FAILED,
        message: error.message,
        timestamp: new Date(),
      };
    }
  }

  async bcAuthorize(params: BCAuthorizeRequest): Promise<BCAuthorizeResponse> {
    try {
      // Get access token for remittance API
      const accessToken = await this.getAccessToken("remittance");

      logger.info(
        {
          accessTokenLength: accessToken.length,
          accessTokenPrefix: accessToken.substring(0, 20),
          tokenType: "remittance",
        },
        "Got access token for BC-Authorize"
      );

      // Prepare form data - order as per MTN documentation
      const formData = new URLSearchParams();
      formData.append("login_hint", params.loginHint);
      formData.append("scope", params.scope);
      formData.append("access_type", params.accessType);

      if (params.consentValidIn) {
        formData.append("consent_valid_in", params.consentValidIn.toString());
      }
      if (params.clientNotificationToken) {
        formData.append(
          "client_notification_token",
          params.clientNotificationToken
        );
      }
      if (params.scopeInstruction) {
        formData.append("scope_instruction", params.scopeInstruction);
      }

      const headers: any = {
        Authorization: `Bearer ${accessToken}`,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.remittanceSubscriptionKey,
        "Content-Type": "application/x-www-form-urlencoded",
      };

      // Add callback URL if provided
      if (params.callbackUrl) {
        headers["X-Callback-Url"] = params.callbackUrl;
      }

      logger.info(
        {
          scope: params.scope,
          loginHint: params.loginHint,
          accessType: params.accessType,
          targetEnvironment: this.targetEnvironment,
          hasCallbackUrl: !!params.callbackUrl,
          url: `${this.baseUrl}/remittance/v1_0/bc-authorize`,
          formData: formData.toString(),
          headers: {
            ...headers,
            Authorization: "Bearer [MASKED]",
            "Ocp-Apim-Subscription-Key":
              headers["Ocp-Apim-Subscription-Key"].substring(0, 8) + "...",
          },
        },
        "Initiating MTN BC-Authorize request"
      );

      const response = await fetch(
        `${this.baseUrl}/remittance/v1_0/bc-authorize`,
        {
          method: "POST",
          headers,
          body: formData.toString(),
        }
      );

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            authReqId: data.auth_req_id,
            interval: data.interval,
            expiresIn: data.expires_in,
          },
          "MTN BC-Authorize successful"
        );

        return {
          success: true,
          authReqId: data.auth_req_id,
          interval: data.interval,
          expiresIn: data.expires_in,
        };
      } else {
        const error = await response.text();
        logger.error(
          {
            statusCode: response.status,
            error,
            responseHeaders: Object.fromEntries(response.headers.entries()),
          },
          "MTN BC-Authorize failed"
        );

        return {
          success: false,
          message: `BC-Authorize failed: ${error}`,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN BC-Authorize error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async createOAuth2Token(
    params: OAuth2TokenRequest
  ): Promise<OAuth2TokenResponse> {
    try {
      // Basic auth for OAuth2 token (API User + API Key)
      const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString(
        "base64"
      );

      // Prepare form data
      const formData = new URLSearchParams();
      formData.append("grant_type", params.grantType);
      formData.append("auth_req_id", params.authReqId);

      if (params.refreshToken) {
        formData.append("refresh_token", params.refreshToken);
      }

      const headers = {
        Authorization: `Basic ${auth}`,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.remittanceSubscriptionKey,
        "Content-Type": "application/x-www-form-urlencoded",
      };

      logger.info(
        {
          grantType: params.grantType,
          authReqId: params.authReqId,
          hasRefreshToken: !!params.refreshToken,
          targetEnvironment: this.targetEnvironment,
        },
        "Creating MTN OAuth2 token"
      );

      const response = await fetch(`${this.baseUrl}/remittance/oauth2/token/`, {
        method: "POST",
        headers,
        body: formData.toString(),
      });

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            accessTokenLength: data.access_token?.length,
            tokenType: data.token_type,
            expiresIn: data.expires_in,
            hasRefreshToken: !!data.refresh_token,
          },
          "MTN OAuth2 token created successfully"
        );

        return {
          success: true,
          accessToken: data.access_token,
          tokenType: data.token_type,
          expiresIn: data.expires_in,
          refreshToken: data.refresh_token,
          refreshExpiresIn: data.refresh_expires_in,
        };
      } else {
        const error = await response.text();
        logger.error(
          {
            statusCode: response.status,
            error,
            responseHeaders: Object.fromEntries(response.headers.entries()),
          },
          "MTN OAuth2 token creation failed"
        );

        return {
          success: false,
          message: `OAuth2 token creation failed: ${error}`,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN OAuth2 token creation error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async refreshOAuth2Token(refreshToken: string): Promise<OAuth2TokenResponse> {
    try {
      // Basic auth for OAuth2 token (API User + API Key)
      const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString(
        "base64"
      );

      // Prepare form data for refresh token grant
      const formData = new URLSearchParams();
      formData.append("grant_type", "refresh_token");
      formData.append("refresh_token", refreshToken);

      const headers = {
        Authorization: `Basic ${auth}`,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.remittanceSubscriptionKey,
        "Content-Type": "application/x-www-form-urlencoded",
      };

      logger.info(
        {
          refreshTokenLength: refreshToken.length,
          targetEnvironment: this.targetEnvironment,
        },
        "Refreshing MTN OAuth2 token"
      );

      const response = await fetch(`${this.baseUrl}/remittance/oauth2/token/`, {
        method: "POST",
        headers,
        body: formData.toString(),
      });

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            accessTokenLength: data.access_token?.length,
            hasNewRefreshToken: !!data.refresh_token,
            expiresIn: data.expires_in,
          },
          "MTN OAuth2 token refreshed successfully"
        );

        return {
          success: true,
          accessToken: data.access_token,
          tokenType: data.token_type,
          expiresIn: data.expires_in,
          refreshToken: data.refresh_token,
          refreshExpiresIn: data.refresh_token_expires_in,
        };
      } else {
        const error = await response.text();
        logger.error(
          {
            statusCode: response.status,
            error,
          },
          "MTN OAuth2 token refresh failed"
        );

        return {
          success: false,
          message: `OAuth2 token refresh failed: ${error}`,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN OAuth2 token refresh error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async revokeOAuth2Consent(
    accessToken: string
  ): Promise<RevokeConsentResponse> {
    try {
      // Note: MTN API doesn't have a specific revoke endpoint documented
      // This is a placeholder implementation that invalidates the token locally
      // In production, you might want to store revoked tokens in a blacklist

      logger.info(
        {
          accessTokenLength: accessToken.length,
        },
        "Revoking MTN OAuth2 consent"
      );

      // For now, we just mark it as successful
      // In a real implementation, you'd want to:
      // 1. Store the revoked token in a blacklist
      // 2. Notify MTN if they provide a revoke endpoint
      // 3. Clean up any stored consent data

      return {
        success: true,
        message: "Consent revoked successfully",
      };
    } catch (error: any) {
      logger.error({ error }, "MTN OAuth2 consent revocation error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getBasicUserInfo(msisdn: string): Promise<BasicUserInfoResponse> {
    try {
      // Get access token for the request
      const accessToken = await this.getAccessToken("remittance");

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.remittanceSubscriptionKey,
      };

      logger.info(
        {
          msisdn,
          targetEnvironment: this.targetEnvironment,
        },
        "Getting MTN basic user info"
      );

      const response = await fetch(
        `${this.baseUrl}/remittance/v1_0/accountholder/msisdn/${msisdn}/basicuserinfo`,
        {
          method: "GET",
          headers,
        }
      );

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            msisdn,
            hasName: !!(data.given_name || data.family_name),
          },
          "MTN basic user info retrieved"
        );

        return {
          success: true,
          userInfo: {
            given_name: data.given_name,
            family_name: data.family_name,
            birthdate: data.birthdate,
            locale: data.locale,
            gender: data.gender,
            status: data.status,
          },
        };
      } else {
        const error = await response.text();
        logger.error(
          {
            statusCode: response.status,
            error,
            msisdn,
          },
          "MTN basic user info request failed"
        );

        return {
          success: false,
          message: `Failed to get basic user info: ${error}`,
        };
      }
    } catch (error: any) {
      logger.error({ error, msisdn }, "MTN basic user info error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async getOAuth2UserInfo(
    accessToken: string
  ): Promise<OAuth2UserInfoResponse> {
    try {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "X-Target-Environment": this.targetEnvironment,
        "Ocp-Apim-Subscription-Key": this.remittanceSubscriptionKey,
      };

      logger.info(
        {
          accessTokenLength: accessToken.length,
          targetEnvironment: this.targetEnvironment,
        },
        "Getting MTN OAuth2 user info"
      );

      const response = await fetch(
        `${this.baseUrl}/remittance/oauth2/v1_0/userinfo`,
        {
          method: "GET",
          headers,
        }
      );

      if (response.status === 200) {
        const data = (await response.json()) as any;

        logger.info(
          {
            sub: data.sub,
            hasName: !!data.name,
            locale: data.locale,
          },
          "MTN OAuth2 user info retrieved"
        );

        return {
          success: true,
          userInfo: {
            sub: data.sub,
            name: data.name,
            given_name: data.given_name,
            family_name: data.family_name,
            birthdate: data.birthdate,
            locale: data.locale,
            gender: data.gender,
            updated_at: data.updated_at,
          },
        };
      } else {
        const error = await response.text();
        logger.error(
          {
            statusCode: response.status,
            error,
            responseHeaders: Object.fromEntries(response.headers.entries()),
          },
          "MTN OAuth2 user info request failed"
        );

        return {
          success: false,
          message: `OAuth2 user info request failed: ${error}`,
        };
      }
    } catch (error: any) {
      logger.error({ error }, "MTN OAuth2 user info error");
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Create a PreApproval for two-phase payment authorization
   */
  async createPreApproval(
    params: PreApprovalRequest
  ): Promise<PreApprovalResponse> {
    try {
      const { preApprovalId, payerPhone, payerMessage, validityTime } = params;
      // Generate a unique reference ID for MTN
      const referenceId = crypto.randomUUID();

      logger.info(
        {
          preApprovalId,
          referenceId,
          payerPhone,
          validityTime,
        },
        "Creating MTN PreApproval"
      );

      // Check if this is a test number and get mapped MTN number
      const mappedPhone = this.formatPhoneNumber(payerPhone);
      const isTestScenario =
        MTNMobileMoneyProvider.FLOWPAY_TEST_NUMBER_MAPPING[payerPhone] !==
        undefined;

      // Prepare PreApproval request
      const requestData = {
        payer: {
          partyIdType: "MSISDN",
          partyId: mappedPhone.replace(/\D/g, ""), // Remove non-digits
        },
        payerCurrency: "EUR", // MTN sandbox uses EUR
        payerMessage: payerMessage || "PreApproval Request",
        validityTime: validityTime.toString(),
      };

      // Store raw request
      const rawCreateRequest = {
        ...requestData,
        originalPhone: payerPhone,
        testScenario: isTestScenario,
      };

      // In sandbox, handle test scenarios
      if (this.targetEnvironment === "sandbox" && isTestScenario) {
        const testResponse = this.handlePreApprovalTestScenario(
          mappedPhone,
          referenceId
        );

        return {
          success: testResponse.success,
          preApprovalId,
          providerPreApprovalId: testResponse.providerReference,
          referenceId,
          status: testResponse.status as PreApprovalStatusEnum,
          message: testResponse.message,
          expiresAt: new Date(Date.now() + validityTime * 1000),
          timestamp: new Date(),
          rawRequest: rawCreateRequest,
          rawResponse: testResponse,
        };
      }

      // Make API call to MTN PreApproval endpoint
      const response = await axios.post(
        `${this.baseUrl}/collection/v2_0/preapproval`,
        requestData,
        {
          headers: {
            "X-Reference-Id": referenceId,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
            Authorization: `Bearer ${await this.getAccessToken()}`,
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(
        {
          status: response.status,
          referenceId,
          preApprovalId,
        },
        "MTN PreApproval created successfully"
      );

      return {
        success: true,
        preApprovalId,
        providerPreApprovalId: referenceId,
        referenceId,
        status: PreApprovalStatusEnum.PENDING,
        message: "PreApproval created successfully",
        expiresAt: new Date(Date.now() + validityTime * 1000),
        timestamp: new Date(),
        rawRequest: rawCreateRequest,
        rawResponse: response.data,
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
        },
        "Failed to create MTN PreApproval"
      );

      return {
        success: false,
        preApprovalId: params.preApprovalId,
        referenceId: params.referenceId,
        status: PreApprovalStatusEnum.FAILED,
        message: error.response?.data?.message || error.message,
        expiresAt: new Date(Date.now() + params.validityTime * 1000),
        timestamp: new Date(),
        rawRequest: params,
        rawResponse: error.response?.data,
      };
    }
  }

  /**
   * Get PreApproval status
   */
  async getPreApprovalStatus(referenceId: string): Promise<PreApprovalStatus> {
    try {
      logger.info({ referenceId }, "Getting MTN PreApproval status");

      const response = await axios.get(
        `${this.baseUrl}/collection/v2_0/preapproval/${referenceId}`,
        {
          headers: {
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
            Authorization: `Bearer ${await this.getAccessToken()}`,
            "Content-Type": "application/json",
          },
        }
      );

      const { status, reason } = response.data;
      const mtnStatus = status?.toUpperCase() || "PENDING";

      // Map MTN status to our PreApprovalStatusEnum
      let mappedStatus: PreApprovalStatusEnum;
      switch (mtnStatus) {
        case "SUCCESSFUL":
        case "SUCCESS":
          mappedStatus = PreApprovalStatusEnum.APPROVED;
          break;
        case "FAILED":
          mappedStatus = PreApprovalStatusEnum.FAILED;
          break;
        case "REJECTED":
          mappedStatus = PreApprovalStatusEnum.REJECTED;
          break;
        case "EXPIRED":
          mappedStatus = PreApprovalStatusEnum.EXPIRED;
          break;
        case "PENDING":
        case "ONGOING":
          mappedStatus = PreApprovalStatusEnum.PENDING;
          break;
        default:
          mappedStatus = PreApprovalStatusEnum.PENDING;
      }

      return {
        preApprovalId: "",
        referenceId,
        providerPreApprovalId: referenceId,
        status: mappedStatus,
        approvedAt:
          mappedStatus === PreApprovalStatusEnum.APPROVED
            ? new Date()
            : undefined,
        rejectedAt:
          mappedStatus === PreApprovalStatusEnum.REJECTED
            ? new Date()
            : undefined,
        cancelledAt: undefined,
        expiresAt: new Date(), // Should be retrieved from API response
        failureReason: reason,
        rawStatusResponse: response.data,
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          response: error.response?.data,
          referenceId,
        },
        "Failed to get MTN PreApproval status"
      );

      return {
        preApprovalId: "",
        referenceId,
        providerPreApprovalId: referenceId,
        status: PreApprovalStatusEnum.FAILED,
        expiresAt: new Date(),
        failureReason: error.response?.data?.message || error.message,
        rawStatusResponse: error.response?.data,
      };
    }
  }

  /**
   * Cancel a PreApproval
   */
  async cancelPreApproval(referenceId: string): Promise<PreApprovalResponse> {
    try {
      logger.info({ referenceId }, "Cancelling MTN PreApproval");

      const response = await axios.delete(
        `${this.baseUrl}/collection/v2_0/preapproval/${referenceId}`,
        {
          headers: {
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
            Authorization: `Bearer ${await this.getAccessToken()}`,
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(
        {
          status: response.status,
          referenceId,
        },
        "MTN PreApproval cancelled successfully"
      );

      return {
        success: true,
        preApprovalId: "",
        referenceId,
        status: PreApprovalStatusEnum.CANCELLED,
        message: "PreApproval cancelled successfully",
        expiresAt: new Date(),
        timestamp: new Date(),
        rawCreateResponse: response.data,
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          response: error.response?.data,
          referenceId,
        },
        "Failed to cancel MTN PreApproval"
      );

      return {
        success: false,
        preApprovalId: "",
        referenceId,
        status: PreApprovalStatusEnum.FAILED,
        message: error.response?.data?.message || error.message,
        expiresAt: new Date(),
        timestamp: new Date(),
        rawCreateResponse: error.response?.data,
      };
    }
  }

  /**
   * Handle PreApproval test scenarios
   */
  private handlePreApprovalTestScenario(
    mtnNumber: string,
    referenceId: string
  ): any {
    // Find the test scenario
    const testEntry = Object.entries(
      MTNMobileMoneyProvider.FLOWPAY_TEST_NUMBER_MAPPING
    ).find(([_, value]) => (value as any).mtnNumber === mtnNumber);

    if (!testEntry) {
      return {
        success: true,
        providerReference: referenceId,
        status: "PENDING",
        message: "PreApproval request accepted",
      };
    }

    const scenario = (testEntry[1] as any).scenario;

    // Handle different PreApproval scenarios
    switch (scenario) {
      case "PAYMENT_PREAPPROVAL_PAYER_FAILED":
      case "DEPOSIT_PREAPPROVAL_PAYER_FAILED":
      case "TRANSFER_PREAPPROVAL_PAYER_FAILED":
      case "PREAPPROVAL_PAYER_FAILED":
      case "REQUEST_TO_PAY_PAYER_FAILED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Payer authorization failed",
          reason: "PAYER_NOT_FOUND",
        };

      case "PAYMENT_PREAPPROVAL_PAYEE_DECLINED":
      case "DEPOSIT_PREAPPROVAL_PAYEE_DECLINED":
      case "TRANSFER_PREAPPROVAL_PAYEE_DECLINED":
      case "PREAPPROVAL_PAYER_REJECTED":
      case "REQUEST_TO_PAY_PAYER_REJECTED":
        return {
          success: false,
          providerReference: referenceId,
          status: "REJECTED",
          message: "Payer rejected the transaction request",
          reason: "PAYER_REJECTED",
        };

      case "PAYMENT_PREAPPROVAL_TIMEOUT":
      case "DEPOSIT_PREAPPROVAL_TIMEOUT":
      case "TRANSFER_PREAPPROVAL_TIMEOUT":
        return {
          success: false,
          providerReference: referenceId,
          status: "EXPIRED",
          message: "PreApproval request timed out",
          reason: "TIMEOUT",
        };

      case "PAYMENT_PREAPPROVAL_EXPIRED":
      case "DEPOSIT_PREAPPROVAL_EXPIRED":
      case "TRANSFER_PREAPPROVAL_EXPIRED":
      case "PREAPPROVAL_PAYER_EXPIRED":
      case "REQUEST_TO_PAY_PAYER_EXPIRED":
        return {
          success: false,
          providerReference: referenceId,
          status: "EXPIRED",
          message: "Request validity period expired",
          reason: "EXPIRED",
        };

      // New scenarios for Request-to-Pay
      case "REQUEST_TO_PAY_PAYER_ONGOING":
      case "PREAPPROVAL_PAYER_ONGOING":
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "Transaction is ongoing",
        };

      case "REQUEST_TO_PAY_PAYER_DELAYED":
      case "PREAPPROVAL_PAYER_DELAYED":
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "Transaction is delayed but will complete",
        };

      case "REQUEST_TO_PAY_PAYER_NOT_FOUND":
      case "PREAPPROVAL_PAYER_NOT_FOUND":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Payer account not found",
          reason: "PAYER_NOT_FOUND",
        };

      case "REQUEST_TO_PAY_PAYEE_NOT_ALLOWED_TO_RECEIVE":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Payee not allowed to receive payments",
          reason: "PAYEE_NOT_ALLOWED_TO_RECEIVE",
        };

      case "REQUEST_TO_PAY_PAYER_NOT_ALLOWED":
      case "PREAPPROVAL_PAYER_NOT_ALLOWED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Payer not allowed to make transactions",
          reason: "PAYER_NOT_ALLOWED",
        };

      case "REQUEST_TO_PAY_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT":
      case "PREAPPROVAL_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Transaction not allowed in target environment",
          reason: "NOT_ALLOWED_TARGET_ENVIRONMENT",
        };

      case "REQUEST_TO_PAY_PAYER_INVALID_CALLBACK_URL_HOST":
      case "PREAPPROVAL_PAYER_INVALID_CALLBACK_URL_HOST":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Invalid callback URL host",
          reason: "INVALID_CALLBACK_URL_HOST",
        };

      case "REQUEST_TO_PAY_PAYER_INVALID_CURRENCY":
      case "PREAPPROVAL_PAYER_INVALID_CURRENCY":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Invalid or unsupported currency",
          reason: "INVALID_CURRENCY",
        };

      case "REQUEST_TO_PAY_PAYER_INTERNAL_PROCESSING_ERROR":
      case "PREAPPROVAL_PAYER_INTERNAL_PROCESSING_ERROR":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Internal processing error occurred",
          reason: "INTERNAL_PROCESSING_ERROR",
        };

      case "REQUEST_TO_PAY_PAYER_SERVICE_UNAVAILABLE":
      case "PREAPPROVAL_PAYER_SERVICE_UNAVAILABLE":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Service temporarily unavailable",
          reason: "SERVICE_UNAVAILABLE",
        };

      case "REQUEST_TO_PAY_COULD_NOT_PERFORM_TRANSACTION":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Could not perform the requested transaction",
          reason: "COULD_NOT_PERFORM_TRANSACTION",
        };

      // New Deposit Payer scenarios
      case "DEPOSIT_PAYER_FAILED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Deposit payer failed",
          reason: "PAYER_FAILED",
        };

      case "DEPOSIT_PAYER_REJECTED":
        return {
          success: false,
          providerReference: referenceId,
          status: "REJECTED",
          message: "Deposit payer rejected",
          reason: "PAYER_REJECTED",
        };

      case "DEPOSIT_PAYER_EXPIRED":
        return {
          success: false,
          providerReference: referenceId,
          status: "EXPIRED",
          message: "Deposit payer expired",
          reason: "EXPIRED",
        };

      case "DEPOSIT_PAYER_ONGOING":
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "Deposit payer ongoing",
        };

      case "DEPOSIT_PAYER_DELAYED":
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "Deposit payer delayed",
        };

      case "DEPOSIT_PAYER_NOT_FOUND":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Deposit payer not found",
          reason: "PAYER_NOT_FOUND",
        };

      case "DEPOSIT_PAYER_PAYEE_NOT_ALLOWED_TO_RECEIVE":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Payee not allowed to receive",
          reason: "PAYEE_NOT_ALLOWED_TO_RECEIVE",
        };

      case "DEPOSIT_PAYER_NOT_ALLOWED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Deposit payer not allowed",
          reason: "PAYER_NOT_ALLOWED",
        };

      case "DEPOSIT_PAYER_NOT_ALLOWED_TARGET_ENVIRONMENT":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Not allowed in target environment",
          reason: "NOT_ALLOWED_TARGET_ENVIRONMENT",
        };

      case "DEPOSIT_PAYER_INVALID_CALLBACK_URL_HOST":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Invalid callback URL host",
          reason: "INVALID_CALLBACK_URL_HOST",
        };

      case "DEPOSIT_PAYER_INVALID_CURRENCY":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Invalid currency",
          reason: "INVALID_CURRENCY",
        };

      case "DEPOSIT_PAYER_INTERNAL_PROCESSING_ERROR":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Internal processing error",
          reason: "INTERNAL_PROCESSING_ERROR",
        };

      case "DEPOSIT_PAYER_SERVICE_UNAVAILABLE":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Service unavailable",
          reason: "SERVICE_UNAVAILABLE",
        };

      case "DEPOSIT_PAYER_COULD_NOT_PERFORM_TRANSACTION":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Could not perform transaction",
          reason: "COULD_NOT_PERFORM_TRANSACTION",
        };

      // New Transfer Payee scenarios
      case "TRANSFER_PAYEE_FAILED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Transfer payee failed",
          reason: "PAYEE_FAILED",
        };

      case "TRANSFER_PAYEE_REJECTED":
        return {
          success: false,
          providerReference: referenceId,
          status: "REJECTED",
          message: "Transfer payee rejected",
          reason: "PAYEE_REJECTED",
        };

      case "TRANSFER_PAYEE_EXPIRED":
        return {
          success: false,
          providerReference: referenceId,
          status: "EXPIRED",
          message: "Transfer payee expired",
          reason: "EXPIRED",
        };

      case "TRANSFER_PAYEE_ONGOING":
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "Transfer payee ongoing",
        };

      case "TRANSFER_PAYEE_DELAYED":
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "Transfer payee delayed",
        };

      case "TRANSFER_PAYEE_NOT_ENOUGH_FUNDS":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Not enough funds",
          reason: "NOT_ENOUGH_FUNDS",
        };

      case "TRANSFER_PAYEE_PAYER_LIMIT_REACHED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Payer limit reached",
          reason: "PAYER_LIMIT_REACHED",
        };

      case "TRANSFER_PAYEE_NOT_FOUND":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Transfer payee not found",
          reason: "PAYEE_NOT_FOUND",
        };

      case "TRANSFER_PAYEE_NOT_ALLOWED":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Transfer payee not allowed",
          reason: "PAYEE_NOT_ALLOWED",
        };

      case "TRANSFER_PAYEE_NOT_ALLOWED_TARGET_ENVIRONMENT":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Not allowed in target environment",
          reason: "NOT_ALLOWED_TARGET_ENVIRONMENT",
        };

      case "TRANSFER_PAYEE_INVALID_CALLBACK_URL_HOST":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Invalid callback URL host",
          reason: "INVALID_CALLBACK_URL_HOST",
        };

      case "TRANSFER_PAYEE_INVALID_CURRENCY":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Invalid currency",
          reason: "INVALID_CURRENCY",
        };

      case "TRANSFER_PAYEE_INTERNAL_PROCESSING_ERROR":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Internal processing error",
          reason: "INTERNAL_PROCESSING_ERROR",
        };

      case "TRANSFER_PAYEE_SERVICE_UNAVAILABLE":
        return {
          success: false,
          providerReference: referenceId,
          status: "FAILED",
          message: "Service unavailable",
          reason: "SERVICE_UNAVAILABLE",
        };

      default:
        return {
          success: true,
          providerReference: referenceId,
          status: "PENDING",
          message: "PreApproval request accepted",
        };
    }
  }

  verifyWebhook(payload: any, signature: string): boolean {
    try {
      // In sandbox, MTN doesn't provide signatures
      if (this.targetEnvironment === "sandbox") {
        logger.debug("Skipping webhook verification in sandbox mode");
        return true;
      }

      // In production, verify the signature
      // MTN uses HMAC-SHA256 with the API secret as the key
      if (!signature) {
        logger.warn("No signature provided for webhook verification");
        return false;
      }

      // Create HMAC signature
      const hmac = crypto.createHmac("sha256", this.apiSecret);
      hmac.update(JSON.stringify(payload));
      const expectedSignature = hmac.digest("base64");

      // Compare signatures
      const isValid = signature === expectedSignature;

      if (!isValid) {
        logger.warn(
          {
            provided: signature,
            expected: expectedSignature,
          },
          "Webhook signature mismatch"
        );
      }

      return isValid;
    } catch (error) {
      logger.error({ error }, "Error verifying MTN webhook signature");
      return false;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      const accessToken = await this.getAccessToken();

      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/account/balance`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
          },
        }
      );

      const latency = Date.now() - startTime;

      if (response.ok) {
        return {
          healthy: true,
          latency,
          message: "MTN Mobile Money API is operational",
        };
      } else {
        return {
          healthy: false,
          latency,
          message: `MTN API returned status ${response.status}`,
        };
      }
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        message: `MTN API health check failed: ${error.message}`,
      };
    }
  }

  async getTransactions(
    startDate: Date,
    endDate: Date
  ): Promise<ProviderTransaction[]> {
    try {
      const accessToken = await this.getAccessToken();

      // MTN transaction history API endpoint
      // In production, this would fetch real transactions
      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/transactions`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
          },
        }
      );

      if (!response.ok) {
        logger.error(
          { status: response.status },
          "Failed to fetch MTN transactions"
        );
        return [];
      }

      const data = (await response.json()) as any;

      // Map MTN transaction format to our format
      return ((data as any).transactions || []).map((tx: any) => ({
        transactionId: tx.externalId,
        providerTransactionId: tx.financialTransactionId,
        amount: parseFloat(tx.amount),
        fee: parseFloat(tx.fee || "0"),
        status: tx.status,
        from: tx.payer?.partyId || "",
        to: tx.payee?.partyId || "",
        timestamp: new Date(tx.timestamp),
        metadata: tx.metadata,
      }));
    } catch (error) {
      logger.error(
        { error, startDate, endDate },
        "Error fetching MTN transactions"
      );
      return [];
    }
  }

  async requestWithdraw(params: WithdrawRequest): Promise<WithdrawResponse> {
    try {
      const accessToken = await this.getAccessToken();
      const referenceId = crypto.randomUUID();

      // Format phone number using the same mapping logic as other transaction types
      const mappedPhoneNumber = this.formatPhoneNumber(params.from);
      const cleanPhoneNumber = mappedPhoneNumber.replace(/[^\d]/g, "");

      const requestBody = {
        amount: params.amount.toString(),
        currency: params.currency,
        externalId: params.withdrawId,
        payer: {
          partyIdType: "MSISDN",
          partyId: cleanPhoneNumber,
        },
        payerMessage: params.payerMessage || "Withdrawal request",
        payeeNote: params.description || "FlowPay withdrawal",
      };

      logger.info(
        {
          withdrawId: params.withdrawId,
          amount: params.amount,
          currency: params.currency,
          phoneNumber: cleanPhoneNumber,
          referenceId,
          callbackUrl: this.callbackUrl,
        },
        "DEBUG: Initiating MTN withdrawal request with callback URL"
      );

      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/requesttowithdraw`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Reference-Id": referenceId,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
            "Content-Type": "application/json",
            "X-Callback-Url": this.callbackUrl,
          },
          body: JSON.stringify(requestBody),
        }
      );

      const responseText = await response.text();
      let responseData;
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = { raw: responseText };
      }

      logger.info(
        {
          withdrawId: params.withdrawId,
          referenceId,
          httpStatus: response.status,
          responseData,
        },
        "MTN withdrawal request response"
      );

      // Handle test scenarios based on phone number
      const status = this.mapWithdrawPhoneToStatus(cleanPhoneNumber);

      if (response.status === 202) {
        return {
          success: true,
          withdrawId: params.withdrawId,
          providerWithdrawId: referenceId,
          referenceId: referenceId,
          status: status,
          message: this.getWithdrawStatusMessage(status),
          timestamp: new Date(),
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: responseText,
          requestData: requestBody,
        };
      } else {
        const errorMessage =
          responseData?.message ||
          `MTN withdrawal failed with status ${response.status}`;
        return {
          success: false,
          withdrawId: params.withdrawId,
          providerWithdrawId: referenceId,
          referenceId: referenceId,
          status: WithdrawStatusEnum.FAILED,
          message: errorMessage,
          timestamp: new Date(),
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: responseText,
          requestData: requestBody,
        };
      }
    } catch (error: any) {
      logger.error(
        { error, withdrawId: params.withdrawId },
        "Error processing MTN withdrawal request"
      );
      return {
        success: false,
        withdrawId: params.withdrawId,
        providerWithdrawId: "",
        referenceId: "",
        status: WithdrawStatusEnum.FAILED,
        message: `Withdrawal request failed: ${error.message}`,
        timestamp: new Date(),
      };
    }
  }

  async checkWithdrawStatus(withdrawId: string): Promise<WithdrawStatus> {
    try {
      // Find the withdrawal by withdrawId to get the referenceId
      // In a real implementation, you'd store this mapping in a database
      // For now, we'll simulate the status check

      const accessToken = await this.getAccessToken();

      // For demonstration, we'll use the withdrawId as referenceId
      // In production, you'd need to store the mapping between withdrawId and MTN referenceId
      const referenceId = withdrawId;

      const response = await fetch(
        `${this.baseUrl}/collection/v1_0/requesttowithdraw/${referenceId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-Target-Environment": this.targetEnvironment,
            "Ocp-Apim-Subscription-Key": this.collectionSubscriptionKey,
          },
        }
      );

      if (response.ok) {
        const statusData = (await response.json()) as any;

        logger.info(
          { withdrawId, referenceId, statusData },
          "MTN withdrawal status retrieved"
        );

        // Map MTN status to our enum
        const mappedStatus = this.mapMTNWithdrawStatus(
          statusData.status || "PENDING"
        );

        return {
          withdrawId: withdrawId,
          providerWithdrawId: referenceId,
          status: mappedStatus,
          amount: parseFloat(statusData.amount || "0"),
          fee: statusData.fee ? parseFloat(statusData.fee) : undefined,
          completedAt: statusData.completedAt
            ? new Date(statusData.completedAt)
            : undefined,
          failureReason: statusData.reason,
          financialTransactionId: statusData.financialTransactionId,
        };
      } else {
        logger.error(
          { withdrawId, referenceId, status: response.status },
          "Failed to get MTN withdrawal status"
        );
        return {
          withdrawId: withdrawId,
          providerWithdrawId: referenceId,
          status: WithdrawStatusEnum.FAILED,
          amount: 0,
          failureReason: `Status check failed: ${response.status}`,
        };
      }
    } catch (error: any) {
      logger.error(
        { error, withdrawId },
        "Error checking MTN withdrawal status"
      );
      return {
        withdrawId: withdrawId,
        providerWithdrawId: "",
        status: WithdrawStatusEnum.FAILED,
        amount: 0,
        failureReason: `Status check error: ${error.message}`,
      };
    }
  }

  // Helper method to map test phone numbers to withdrawal statuses
  private mapWithdrawPhoneToStatus(phoneNumber: string): WithdrawStatusEnum {
    // Map test phone numbers to specific statuses for testing scenarios
    const phoneToStatus: Record<string, WithdrawStatusEnum> = {
      "46733123400": WithdrawStatusEnum.COMPLETED, // RequestToWithdrawSuccess
      "46733123450": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerFailed
      "46733123451": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerRejected
      "46733123452": WithdrawStatusEnum.EXPIRED, // RequestToWithdrawPayerExpired
      "46733123453": WithdrawStatusEnum.ONGOING, // RequestToWithdrawPayerOngoing
      "46733123454": WithdrawStatusEnum.DELAYED, // RequestToWithdrawPayerDelayed
      "46733123455": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerNotFound
      "46733123456": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerPayeeNotAllowedToReceive
      "46733123457": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerNotAllowed
      "46733123458": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerNotAllowedTargetEnvironment
      "46733123459": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerInvalidCallbackUrlHost
      "46733123460": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerInvalidCurrency
      "46733123461": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerInternalProcessingError
      "46733123462": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerServiceUnavailable
      "46733123463": WithdrawStatusEnum.FAILED, // RequestToWithdrawPayerCouldNotPerformTransaction
    };

    return phoneToStatus[phoneNumber] || WithdrawStatusEnum.PENDING;
  }

  // Helper method to get status message
  private getWithdrawStatusMessage(status: WithdrawStatusEnum): string {
    const messages: Record<WithdrawStatusEnum, string> = {
      [WithdrawStatusEnum.PENDING]: "Withdrawal request is pending",
      [WithdrawStatusEnum.PROCESSING]: "Withdrawal is being processed",
      [WithdrawStatusEnum.COMPLETED]: "Withdrawal completed successfully",
      [WithdrawStatusEnum.FAILED]: "Withdrawal request failed",
      [WithdrawStatusEnum.CANCELLED]: "Withdrawal was cancelled",
      [WithdrawStatusEnum.EXPIRED]: "Withdrawal request expired",
      [WithdrawStatusEnum.ONGOING]: "Withdrawal is ongoing",
      [WithdrawStatusEnum.DELAYED]: "Withdrawal is delayed",
    };

    return messages[status] || "Unknown withdrawal status";
  }

  // Helper method to map MTN API status to our enum
  private mapMTNWithdrawStatus(mtnStatus: string): WithdrawStatusEnum {
    const statusMap: Record<string, WithdrawStatusEnum> = {
      PENDING: WithdrawStatusEnum.PENDING,
      SUCCESSFUL: WithdrawStatusEnum.COMPLETED,
      FAILED: WithdrawStatusEnum.FAILED,
      REJECTED: WithdrawStatusEnum.FAILED,
      EXPIRED: WithdrawStatusEnum.EXPIRED,
      ONGOING: WithdrawStatusEnum.ONGOING,
      DELAYED: WithdrawStatusEnum.DELAYED,
    };

    return statusMap[mtnStatus] || WithdrawStatusEnum.PENDING;
  }
}
