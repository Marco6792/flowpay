export interface PaymentProvider {
  name: string;

  /**
   * Initialize payment with provider
   */
  initiatePayment(params: PaymentRequest): Promise<PaymentResponse>;

  /**
   * Check payment status
   */
  checkStatus(transactionId: string): Promise<PaymentStatus>;

  /**
   * Process refund
   */
  refund(transactionId: string, amount?: number): Promise<RefundResponse>;

  /**
   * Check refund status
   */
  checkRefundStatus(refundId: string): Promise<RefundStatus>;

  /**
   * Send money transfer to another user
   */
  transfer(params: TransferRequest): Promise<TransferResponse>;

  /**
   * Check transfer status
   */
  checkTransferStatus(transferId: string): Promise<TransferStatus>;

  /**
   * Get account balance
   */
  getBalance(): Promise<BalanceResponse>;

  /**
   * Validate if recipient account is active
   */
  validateRecipient(accountId: string, accountType: string): Promise<ValidationResponse>;

  /**
   * Get basic user information
   */
  getUserInfo(accountId: string, accountType: string): Promise<UserInfoResponse>;

  /**
   * Deposit funds to an account
   */
  deposit(params: DepositRequest): Promise<DepositResponse>;

  /**
   * Check deposit status
   */
  checkDepositStatus(depositId: string): Promise<DepositStatus>;

  /**
   * Create PreApproval for two-phase payment authorization
   */
  createPreApproval(params: PreApprovalRequest): Promise<PreApprovalResponse>;

  /**
   * Check PreApproval status
   */
  getPreApprovalStatus(referenceId: string): Promise<PreApprovalStatus>;

  /**
   * Cancel PreApproval
   */
  cancelPreApproval(referenceId: string): Promise<PreApprovalCancelResponse>;


  /**
   * Initiate business consent authorization flow
   */
  bcAuthorize(params: BCAuthorizeRequest): Promise<BCAuthorizeResponse>;

  /**
   * Create OAuth2 token from authorization
   */
  createOAuth2Token(params: OAuth2TokenRequest): Promise<OAuth2TokenResponse>;

  /**
   * Get user info using OAuth2 token
   */
  getOAuth2UserInfo(accessToken: string): Promise<OAuth2UserInfoResponse>;

  /**
   * Refresh OAuth2 token using refresh token
   */
  refreshOAuth2Token(refreshToken: string): Promise<OAuth2TokenResponse>;

  /**
   * Revoke OAuth2 consent
   */
  revokeOAuth2Consent(accessToken: string): Promise<RevokeConsentResponse>;

  /**
   * Get basic user info without consent
   */
  getBasicUserInfo(msisdn: string): Promise<BasicUserInfoResponse>;

  /**
   * Verify webhook signature
   */
  verifyWebhook(payload: any, signature: string): boolean;

  /**
   * Get provider health status
   */
  healthCheck(): Promise<HealthStatus>;

  /**
   * Get transactions for reconciliation
   */
  getTransactions(startDate: Date, endDate: Date): Promise<ProviderTransaction[]>;

  /**
   * Request withdrawal from user account
   */
  requestWithdraw(params: WithdrawRequest): Promise<WithdrawResponse>;

  /**
   * Check withdrawal status
   */
  checkWithdrawStatus(withdrawId: string): Promise<WithdrawStatus>;
}

export interface PaymentRequest {
  transactionId: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, any>;
  // Optional provider routing
  providerMode?: string; // e.g., 'mtn-v2'
  providerOptions?: Record<string, any>; // provider-specific options (e.g., MTN v2 payment fields)
}

export interface PaymentResponse {
  success: boolean;
  providerTransactionId: string;
  originalRequestReference?: string; // For storing original X-Reference-Id for refunds
  status: PaymentStatusEnum;
  message?: string;
  fee?: number;
  timestamp: Date;
  financialTransactionId?: string; // Provider's financial transaction ID (MTN's internal reference)
  rawProviderResponse?: any; // Store complete raw response from provider
}

export interface PaymentStatus {
  transactionId: string;
  providerTransactionId: string;
  status: PaymentStatusEnum;
  amount: number;
  currency?: string; // Currency from provider response
  fee?: number;
  completedAt?: Date;
  failureReason?: string;
  financialTransactionId?: string; // Provider's financial transaction ID (MTN's internal reference)
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  amount: number;
  status: RefundStatusEnum;
  message?: string;
  financialTransactionId?: string; // Provider's financial transaction ID, when available
  errorCode?: number;
  errorDetails?: {
    code: number;
    message: string;
    providerErrorCode?: string;
    providerErrorMessage?: string;
    retryable: boolean;
  };
  rawProviderResponse?: any; // Store complete raw response from provider
}

export interface RefundStatus {
  refundId: string;
  status: RefundStatusEnum;
  amount: number;
  completedAt?: Date;
  failureReason?: string;
  financialTransactionId?: string; // Provider's financial transaction ID, when available
}

export interface HealthStatus {
  healthy: boolean;
  latency: number;
  message?: string;
}

export enum PaymentStatusEnum {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED'
}

export enum RefundStatusEnum {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface ProviderTransaction {
  transactionId: string;
  providerTransactionId: string;
  amount: number;
  fee?: number;
  status: string;
  from: string;
  to: string;
  timestamp: Date;
  metadata?: any;
}

// Transfer-related interfaces
export interface TransferRequest {
  transferId: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface TransferResponse {
  success: boolean;
  transferId: string;
  providerTransferId: string;
  status: TransferStatusEnum;
  message?: string;
  fee?: number;
  timestamp: Date;
  financialTransactionId?: string; // Provider's financial transaction ID (MTN's internal reference)
  // Optional debugging properties
  httpStatus?: number;
  httpStatusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  transferStatusDetails?: any;
  requestData?: any;
}

export interface TransferStatus {
  transferId: string;
  providerTransferId: string;
  status: TransferStatusEnum;
  amount: number;
  fee?: number;
  completedAt?: Date;
  failureReason?: string;
  financialTransactionId?: string; // Provider's financial transaction ID (MTN's internal reference)
}

export enum TransferStatusEnum {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

// Balance-related interfaces
export interface BalanceResponse {
  success: boolean;
  balances: Balance[];
  timestamp: Date;
}

export interface Balance {
  currency: string;
  availableBalance: number;
  accountStatus: string;
}

// Validation interfaces
export interface ValidationResponse {
  success: boolean;
  isActive: boolean;
  accountHolder?: string;
  message?: string;
}

export interface UserInfoResponse {
  success: boolean;
  userInfo?: UserInfo;
  message?: string;
}

export interface UserInfo {
  name: string;
  given_name?: string;
  family_name?: string;
  birthdate?: string;
  locale?: string;
  gender?: string;
  status?: string;
}

// PreApproval interfaces
export interface PreApprovalRequest {
  preApprovalId: string;
  payerPhone: string;
  payerMessage?: string;
  validityTime: number; // in seconds
  metadata?: Record<string, any>;
}

export interface PreApprovalResponse {
  success: boolean;
  preApprovalId: string;
  providerPreApprovalId?: string;
  referenceId: string;
  status: PreApprovalStatusEnum;
  message?: string;
  expiresAt: Date;
  timestamp: Date;
  rawRequest?: any; // Store complete request
  rawResponse?: any; // Store complete response
}

export interface PreApprovalStatus {
  preApprovalId: string;
  providerPreApprovalId?: string;
  status: PreApprovalStatusEnum;
  approvedAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
  expiresAt: Date;
  failureReason?: string;
  rawResponse?: any; // Store complete status response
}

export enum PreApprovalStatusEnum {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED'
}

// Deposit interfaces
export interface DepositRequest {
  depositId: string;
  accountId: string;
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface DepositResponse {
  success: boolean;
  depositId: string;
  providerDepositId: string;
  status: DepositStatusEnum;
  message?: string;
  fee?: number;
  timestamp: Date;
  // Optional debugging properties
  httpStatus?: number;
  httpStatusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  requestData?: any;
}

export interface DepositStatus {
  depositId: string;
  providerDepositId: string;
  status: DepositStatusEnum;
  amount: number;
  fee?: number;
  completedAt?: Date;
  failureReason?: string;
  financialTransactionId?: string;
}

export enum DepositStatusEnum {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

// BC-Authorize interfaces
export interface BCAuthorizeRequest {
  scope: string;
  loginHint: string; // MSISDN in format ID:{msisdn}/MSISDN
  accessType: 'online' | 'offline';
  consentValidIn?: number; // seconds
  clientNotificationToken?: string;
  scopeInstruction?: string;
  callbackUrl?: string;
}

export interface BCAuthorizeResponse {
  success: boolean;
  authReqId?: string;
  interval?: number; // polling interval in seconds
  expiresIn?: number; // seconds until consent expires
  message?: string;
}

// OAuth2 interfaces
export interface OAuth2TokenRequest {
  // Per MTN MoMo docs, use CIBA grant for bc-authorize
  grantType: 'urn:openid:params:grant-type:ciba' | 'refresh_token';
  authReqId: string;
  refreshToken?: string; // for refresh_token grant type
}

export interface OAuth2TokenResponse {
  success: boolean;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  message?: string;
}

export interface OAuth2UserInfoResponse {
  success: boolean;
  userInfo?: OAuth2UserInfo;
  message?: string;
}

export interface OAuth2UserInfo {
  sub: string; // subject identifier
  name?: string;
  given_name?: string;
  family_name?: string;
  birthdate?: string;
  locale?: string;
  gender?: string;
  updated_at?: number;
}

export interface RevokeConsentResponse {
  success: boolean;
  message?: string;
}

export interface BasicUserInfoResponse {
  success: boolean;
  userInfo?: BasicUserInfo;
  message?: string;
}

export interface BasicUserInfo {
  given_name?: string;
  family_name?: string;
  birthdate?: string;
  locale?: string;
  gender?: string;
  status?: string;
}

// PreApproval interfaces for two-phase payment authorization
export interface PreApprovalRequest {
  preApprovalId: string;
  referenceId: string; // UUID for provider reference
  payerPhone: string;
  payerCurrency: string;
  payerMessage?: string;
  validityTime: number; // In seconds
  metadata?: Record<string, any>;
}

export interface PreApprovalResponse {
  success: boolean;
  preApprovalId: string;
  referenceId: string;
  providerReference?: string;
  status: PreApprovalStatusEnum;
  message?: string;
  expiresAt: Date;
  timestamp: Date;
  // Raw responses - ALWAYS store complete provider responses
  rawCreateRequest?: any;
  rawCreateResponse?: any;
}

export interface PreApprovalStatus {
  preApprovalId: string;
  referenceId: string;
  status: PreApprovalStatusEnum;
  approvedAt?: Date;
  rejectedAt?: Date;
  expiredAt?: Date;
  failureReason?: string;
  // Raw status response
  rawStatusResponse?: any;
}

export interface PreApprovalCancelResponse {
  success: boolean;
  preApprovalId: string;
  status: PreApprovalStatusEnum;
  message?: string;
  // Raw cancel response
  rawCancelResponse?: any;
}

export interface DepositStatus {
  depositId: string;
  providerDepositId: string;
  status: DepositStatusEnum;
  amount: number;
  fee?: number;
  completedAt?: Date;
  failureReason?: string;
  financialTransactionId?: string;
}

// Withdraw interfaces (RequestToWithdraw)
export interface WithdrawRequest {
  withdrawId: string;
  from: string; // payer phone number
  amount: number;
  currency: string;
  description?: string;
  payerMessage?: string;
  metadata?: Record<string, any>;
}

export interface WithdrawResponse {
  success: boolean;
  withdrawId: string;
  providerWithdrawId: string;
  referenceId: string;
  status: WithdrawStatusEnum;
  message?: string;
  fee?: number;
  timestamp: Date;
  financialTransactionId?: string; // Provider's financial transaction ID (MTN's internal reference)
  // Optional debugging properties
  httpStatus?: number;
  httpStatusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  requestData?: any;
}

export interface WithdrawStatus {
  withdrawId: string;
  providerWithdrawId: string;
  status: WithdrawStatusEnum;
  amount: number;
  fee?: number;
  completedAt?: Date;
  failureReason?: string;
  financialTransactionId?: string;
}

export enum WithdrawStatusEnum {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  ONGOING = 'ONGOING',
  DELAYED = 'DELAYED'
}
