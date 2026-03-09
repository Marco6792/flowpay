/**
 * Refund Transaction Error Codes
 * These error codes provide detailed information about refund transaction failures
 */
export enum RefundTransactionErrorCode {
  REFUND_TRANSACTION_NOT_FOUND = 1,
  REFUND_TRANSACTION_FAILED = 2,
  REFUND_TRANSACTION_REJECTED = 3,
  REFUND_TRANSACTION_EXPIRED = 4,
  REFUND_TRANSACTION_ONGOING = 5,
  REFUND_TRANSACTION_DELAYED = 6,
  REFUND_TRANSACTION_NOT_ALLOWED = 7,
  REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT = 8,
  REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST = 9,
  REFUND_TRANSACTION_INVALID_CURRENCY = 10,
  REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR = 11,
  REFUND_TRANSACTION_SERVICE_UNAVAILABLE = 12,
  REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION = 13,
}

/**
 * Refund Transaction Error Messages
 * Human-readable error messages corresponding to error codes
 */
export const RefundTransactionErrorMessages: Record<RefundTransactionErrorCode, string> = {
  [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND]: 'The refund transaction could not be found',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED]: 'The refund transaction has failed',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_REJECTED]: 'The refund transaction was rejected',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_EXPIRED]: 'The refund transaction has expired',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_ONGOING]: 'The refund transaction is still ongoing',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_DELAYED]: 'The refund transaction has been delayed',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED]: 'The refund transaction is not allowed',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT]: 'The refund transaction is not allowed in the target environment',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST]: 'Invalid callback URL host for refund transaction',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CURRENCY]: 'Invalid currency for refund transaction',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR]: 'Internal processing error during refund transaction',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_SERVICE_UNAVAILABLE]: 'Refund service is currently unavailable',
  [RefundTransactionErrorCode.REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION]: 'Could not perform the refund transaction',
};

/**
 * Refund Error Details Interface
 * Provides structured error information for refund failures
 */
export interface RefundErrorDetails {
  code: RefundTransactionErrorCode;
  message: string;
  timestamp: Date;
  refundId?: string;
  originalTransactionId?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
  retryable: boolean;
}

/**
 * Enhanced Refund Status Enum
 * Extends the basic RefundStatus with more detailed states
 */
export enum EnhancedRefundStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  DELAYED = 'DELAYED',
  NOT_ALLOWED = 'NOT_ALLOWED',
}

/**
 * Utility function to create RefundErrorDetails
 */
export function createRefundError(
  code: RefundTransactionErrorCode,
  refundId?: string,
  originalTransactionId?: string,
  providerErrorCode?: string,
  providerErrorMessage?: string
): RefundErrorDetails {
  return {
    code,
    message: RefundTransactionErrorMessages[code],
    timestamp: new Date(),
    refundId,
    originalTransactionId,
    providerErrorCode,
    providerErrorMessage,
    retryable: isRetryableError(code),
  };
}

/**
 * Determines if a refund error is retryable
 */
export function isRetryableError(code: RefundTransactionErrorCode): boolean {
  const retryableErrors = [
    RefundTransactionErrorCode.REFUND_TRANSACTION_ONGOING,
    RefundTransactionErrorCode.REFUND_TRANSACTION_DELAYED,
    RefundTransactionErrorCode.REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR,
    RefundTransactionErrorCode.REFUND_TRANSACTION_SERVICE_UNAVAILABLE,
    RefundTransactionErrorCode.REFUND_TRANSACTION_COULD_NOT_PERFORM_TRANSACTION,
  ];

  return retryableErrors.includes(code);
}

/**
 * Maps MTN MoMo API error codes to our refund error codes
 * Based on official MTN disbursement API specification
 */
export function mapProviderErrorToRefundError(
  providerErrorCode: string,
  providerErrorMessage?: string
): RefundTransactionErrorCode {
  const errorMappings: Record<string, RefundTransactionErrorCode> = {
    // Official MTN MoMo API error codes from disbursement.json
    'PAYEE_NOT_FOUND': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND,
    'PAYER_NOT_FOUND': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND,
    'RESOURCE_NOT_FOUND': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_FOUND,
    'NOT_ALLOWED': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED,
    'NOT_ALLOWED_TARGET_ENVIRONMENT': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED_TARGET_ENVIRONMENT,
    'INVALID_CALLBACK_URL_HOST': RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CALLBACK_URL_HOST,
    'INVALID_CURRENCY': RefundTransactionErrorCode.REFUND_TRANSACTION_INVALID_CURRENCY,
    'SERVICE_UNAVAILABLE': RefundTransactionErrorCode.REFUND_TRANSACTION_SERVICE_UNAVAILABLE,
    'INTERNAL_PROCESSING_ERROR': RefundTransactionErrorCode.REFUND_TRANSACTION_INTERNAL_PROCESSING_ERROR,
    'NOT_ENOUGH_FUNDS': RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED,
    'PAYER_LIMIT_REACHED': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED,
    'PAYEE_NOT_ALLOWED_TO_RECEIVE': RefundTransactionErrorCode.REFUND_TRANSACTION_NOT_ALLOWED,
    'PAYMENT_NOT_APPROVED': RefundTransactionErrorCode.REFUND_TRANSACTION_REJECTED,
    'APPROVAL_REJECTED': RefundTransactionErrorCode.REFUND_TRANSACTION_REJECTED,
    'EXPIRED': RefundTransactionErrorCode.REFUND_TRANSACTION_EXPIRED,
    'TRANSACTION_CANCELED': RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED,
    'RESOURCE_ALREADY_EXIST': RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED,
  };

  return errorMappings[providerErrorCode] || RefundTransactionErrorCode.REFUND_TRANSACTION_FAILED;
}
