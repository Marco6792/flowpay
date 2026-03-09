# Merchant Schema Enhancement for FlowPay

## Current Schema Analysis

The current `User` model represents merchants but lacks merchant-specific features. Here's a proposed enhancement to better support merchant operations.

## Proposed Enhanced Merchant Schema

```prisma
// =================== MERCHANT MANAGEMENT ===================

model Merchant {
  id                String          @id @default(cuid())
  email             String          @unique
  passwordHash      String
  
  // Business Information
  businessName      String
  businessType      BusinessType    @default(ECOMMERCE)
  registrationNumber String?        // Business registration number
  taxNumber         String?         // Tax ID
  
  // Contact Information
  phoneNumber       String?
  alternateEmail    String?
  address           String?
  city              String?
  country           String          @default("CM") // ISO country code
  
  // Account Status
  status            MerchantStatus  @default(PENDING_VERIFICATION)
  isVerified        Boolean         @default(false)
  verifiedAt        DateTime?
  kycStatus         KYCStatus       @default(PENDING)
  kycCompletedAt    DateTime?
  
  // Financial Settings
  settlementAccount String?         // Bank account for settlements
  settlementBank    String?
  preferredCurrency String          @default("XAF")
  
  // Limits & Tiers
  tier              MerchantTier    @default(STARTER)
  dailyLimit        Float           @default(1000000) // Daily transaction limit
  monthlyLimit      Float           @default(30000000) // Monthly limit
  transactionLimit  Float           @default(500000) // Per transaction limit
  
  // Commission & Fees
  commissionRate    Float           @default(0.02) // 2% default commission
  customFees        Json?           // Custom fee structure if any
  
  // Timestamps
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  lastLoginAt       DateTime?
  
  // Relations
  apiKeys           ApiKey[]
  settings          MerchantSettings?
  payments          Payment[]
  wallets           MerchantWallet[]
  settlements       Settlement[]
  documents         MerchantDocument[]
  notifications     Notification[]
  supportTickets    SupportTicket[]
  
  @@index([email])
  @@index([status])
  @@index([businessName])
  @@map("merchants")
}

enum BusinessType {
  ECOMMERCE
  RETAIL
  RESTAURANT
  SERVICES
  TRANSPORTATION
  EDUCATION
  HEALTHCARE
  NGO
  OTHER
}

enum MerchantStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  BLOCKED
  INACTIVE
}

enum KYCStatus {
  PENDING
  IN_REVIEW
  APPROVED
  REJECTED
  EXPIRED
}

enum MerchantTier {
  STARTER     // Basic features, lower limits
  BUSINESS    // Standard business features
  ENTERPRISE  // Full features, higher limits
  CUSTOM      // Custom negotiated terms
}

// =================== MERCHANT SETTINGS ===================

model MerchantSettings {
  id                String   @id @default(cuid())
  merchantId        String   @unique
  
  // Webhook Configuration
  webhookUrl        String?
  webhookSecret     String?
  webhookEvents    String[] @default(["payment.success", "payment.failed"])
  
  // Notification Preferences
  notificationEmail String?
  notificationPhone String?
  enableSMS         Boolean  @default(false)
  enableEmail       Boolean  @default(true)
  enablePush        Boolean  @default(false)
  
  // Payment Preferences
  defaultProvider   Provider?
  allowedProviders  Provider[] @default([MTN, ORANGE])
  autoRetry         Boolean  @default(true)
  retryAttempts     Int      @default(3)
  
  // Display Settings
  timezone          String   @default("Africa/Douala")
  language          String   @default("en")
  dateFormat        String   @default("DD/MM/YYYY")
  
  // Security Settings
  ipWhitelist       String[] @default([])
  requireOTP        Boolean  @default(false)
  twoFactorEnabled  Boolean  @default(false)
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  // Relations
  merchant          Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  
  @@map("merchant_settings")
}

// =================== MERCHANT WALLET ===================

model MerchantWallet {
  id           String       @id @default(cuid())
  merchantId   String
  provider     Provider
  balance      Float        @default(0)
  currency     String       @default("XAF")
  status       WalletStatus @default(ACTIVE)
  
  // Provider-specific IDs
  providerWalletId String?  // MTN/Orange wallet ID
  
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  
  // Relations
  merchant     Merchant     @relation(fields: [merchantId], references: [id])
  transactions WalletTransaction[]
  
  @@unique([merchantId, provider])
  @@index([merchantId])
  @@map("merchant_wallets")
}

enum WalletStatus {
  ACTIVE
  FROZEN
  CLOSED
}

// =================== WALLET TRANSACTIONS ===================

model WalletTransaction {
  id            String              @id @default(cuid())
  walletId      String
  type          TransactionType
  amount        Float
  balanceBefore Float
  balanceAfter  Float
  reference     String              @unique
  description   String?
  metadata      Json?
  createdAt     DateTime            @default(now())
  
  // Relations
  wallet        MerchantWallet      @relation(fields: [walletId], references: [id])
  
  @@index([walletId])
  @@index([type])
  @@index([createdAt])
  @@map("wallet_transactions")
}

enum TransactionType {
  CREDIT      // Money in
  DEBIT       // Money out
  FEE         // Transaction fee
  SETTLEMENT  // Settlement to bank
  REFUND      // Refund issued
  ADJUSTMENT  // Manual adjustment
}

// =================== SETTLEMENTS ===================

model Settlement {
  id              String           @id @default(cuid())
  merchantId      String
  amount          Float
  currency        String           @default("XAF")
  status          SettlementStatus @default(PENDING)
  
  // Bank Details
  bankName        String
  accountNumber   String
  accountName     String
  
  // Transaction Details
  transactionCount Int
  startDate       DateTime
  endDate         DateTime
  
  // Processing Info
  processedAt     DateTime?
  failureReason   String?
  bankReference   String?
  
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  
  // Relations
  merchant        Merchant         @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId])
  @@index([status])
  @@index([createdAt])
  @@map("settlements")
}

enum SettlementStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}

// =================== MERCHANT DOCUMENTS (KYC) ===================

model MerchantDocument {
  id           String       @id @default(cuid())
  merchantId   String
  type         DocumentType
  fileName     String
  fileUrl      String
  fileSize     Int
  status       DocumentStatus @default(PENDING_REVIEW)
  reviewNote   String?
  reviewedAt   DateTime?
  reviewedBy   String?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  
  // Relations
  merchant     Merchant     @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId])
  @@index([type])
  @@index([status])
  @@map("merchant_documents")
}

enum DocumentType {
  BUSINESS_REGISTRATION
  TAX_CERTIFICATE
  BANK_STATEMENT
  UTILITY_BILL
  ID_CARD
  OTHER
}

enum DocumentStatus {
  PENDING_REVIEW
  APPROVED
  REJECTED
  EXPIRED
}

// =================== SUPPORT TICKETS ===================

model SupportTicket {
  id           String       @id @default(cuid())
  merchantId   String
  subject      String
  description  String       @db.Text
  category     TicketCategory
  priority     TicketPriority @default(NORMAL)
  status       TicketStatus   @default(OPEN)
  
  // Support Agent Info
  assignedTo   String?
  resolvedAt   DateTime?
  resolution   String?      @db.Text
  
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  
  // Relations
  merchant     Merchant     @relation(fields: [merchantId], references: [id])
  messages     TicketMessage[]
  
  @@index([merchantId])
  @@index([status])
  @@index([priority])
  @@map("support_tickets")
}

enum TicketCategory {
  TECHNICAL
  BILLING
  ACCOUNT
  INTEGRATION
  OTHER
}

enum TicketPriority {
  LOW
  NORMAL
  HIGH
  URGENT
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  WAITING_RESPONSE
  RESOLVED
  CLOSED
}

model TicketMessage {
  id          String        @id @default(cuid())
  ticketId    String
  senderId    String        // Can be merchant or support agent
  message     String        @db.Text
  attachments Json?
  createdAt   DateTime      @default(now())
  
  // Relations
  ticket      SupportTicket @relation(fields: [ticketId], references: [id])
  
  @@index([ticketId])
  @@map("ticket_messages")
}

// =================== MERCHANT STATISTICS ===================

model MerchantStatistics {
  id                String   @id @default(cuid())
  merchantId        String   @unique
  
  // Transaction Stats
  totalTransactions Int      @default(0)
  successfulTxns    Int      @default(0)
  failedTxns        Int      @default(0)
  totalVolume       Float    @default(0)
  
  // Period Stats (auto-updated daily)
  dailyVolume       Float    @default(0)
  weeklyVolume      Float    @default(0)
  monthlyVolume     Float    @default(0)
  
  // Performance Metrics
  successRate       Float    @default(0) // Percentage
  averageTxnAmount  Float    @default(0)
  
  lastUpdated       DateTime @default(now())
  
  @@index([merchantId])
  @@map("merchant_statistics")
}
```

## Migration Strategy

### Step 1: Create Migration Script
```sql
-- Rename users table to merchants
ALTER TABLE users RENAME TO merchants;

-- Add new columns
ALTER TABLE merchants 
  ADD COLUMN business_type VARCHAR(50) DEFAULT 'ECOMMERCE',
  ADD COLUMN registration_number VARCHAR(100),
  ADD COLUMN tax_number VARCHAR(100),
  ADD COLUMN phone_number VARCHAR(20),
  ADD COLUMN status VARCHAR(50) DEFAULT 'PENDING_VERIFICATION',
  ADD COLUMN tier VARCHAR(50) DEFAULT 'STARTER',
  ADD COLUMN daily_limit DECIMAL(15,2) DEFAULT 1000000,
  ADD COLUMN commission_rate DECIMAL(5,4) DEFAULT 0.02;
```

### Step 2: Update Relations
```sql
-- Update foreign key references
ALTER TABLE api_keys 
  DROP CONSTRAINT api_keys_user_id_fkey,
  ADD CONSTRAINT api_keys_merchant_id_fkey 
    FOREIGN KEY (user_id) REFERENCES merchants(id);
```

## API Endpoint Changes

### Current Endpoints
```
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/users/profile
```

### Enhanced Endpoints
```
# Merchant Management
POST   /api/v1/merchants/register
POST   /api/v1/merchants/login
GET    /api/v1/merchants/profile
PUT    /api/v1/merchants/profile
POST   /api/v1/merchants/verify-kyc

# Merchant Settings
GET    /api/v1/merchants/settings
PUT    /api/v1/merchants/settings

# Wallet Management
GET    /api/v1/merchants/wallets
GET    /api/v1/merchants/wallets/:provider
GET    /api/v1/merchants/wallets/:provider/transactions

# Settlements
GET    /api/v1/merchants/settlements
POST   /api/v1/merchants/settlements/request
GET    /api/v1/merchants/settlements/:id

# Statistics & Reports
GET    /api/v1/merchants/statistics
GET    /api/v1/merchants/reports/transactions
GET    /api/v1/merchants/reports/revenue

# Support
POST   /api/v1/support/tickets
GET    /api/v1/support/tickets
GET    /api/v1/support/tickets/:id
POST   /api/v1/support/tickets/:id/messages
```

## Benefits of Enhanced Schema

### 1. **Business Information**
- Proper KYC/compliance tracking
- Business type categorization
- Tax and registration tracking

### 2. **Financial Management**
- Wallet balance tracking per provider
- Settlement management
- Commission tracking
- Transaction limits by tier

### 3. **Operational Features**
- Document management for verification
- Support ticket system
- Detailed statistics tracking
- Multi-provider wallet management

### 4. **Security & Compliance**
- IP whitelisting
- Two-factor authentication
- Audit trail through relations
- Document verification workflow

### 5. **Scalability**
- Tier-based feature access
- Custom fee structures
- Provider-specific settings
- Bulk operations support

## Implementation Priority

### Phase 1: Core Enhancements
1. Add merchant-specific fields to User model
2. Implement merchant tiers and limits
3. Add wallet management

### Phase 2: Financial Features
4. Settlement processing
5. Commission calculation
6. Transaction statistics

### Phase 3: Support & Compliance
7. KYC document management
8. Support ticket system
9. Advanced reporting

## Example Usage

### Merchant Registration
```javascript
const merchant = await prisma.merchant.create({
  data: {
    email: 'shop@example.com',
    passwordHash: hashedPassword,
    businessName: 'Example Shop',
    businessType: 'ECOMMERCE',
    tier: 'STARTER',
    settings: {
      create: {
        webhookUrl: 'https://shop.example.com/webhooks',
        defaultProvider: 'MTN',
        allowedProviders: ['MTN', 'ORANGE']
      }
    },
    wallets: {
      create: [
        { provider: 'MTN', currency: 'XAF' },
        { provider: 'ORANGE', currency: 'XAF' }
      ]
    }
  }
});
```

### Check Merchant Limits
```javascript
async function canProcessPayment(merchantId, amount) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    include: { 
      statistics: true 
    }
  });
  
  // Check transaction limit
  if (amount > merchant.transactionLimit) {
    return { allowed: false, reason: 'Exceeds transaction limit' };
  }
  
  // Check daily limit
  if (merchant.statistics.dailyVolume + amount > merchant.dailyLimit) {
    return { allowed: false, reason: 'Exceeds daily limit' };
  }
  
  return { allowed: true };
}
```

### Process Settlement
```javascript
async function createSettlement(merchantId) {
  const wallet = await prisma.merchantWallet.findFirst({
    where: { 
      merchantId,
      provider: 'MTN',
      balance: { gt: 0 }
    }
  });
  
  if (!wallet) return;
  
  const settlement = await prisma.settlement.create({
    data: {
      merchantId,
      amount: wallet.balance,
      currency: wallet.currency,
      bankName: merchant.settlementBank,
      accountNumber: merchant.settlementAccount,
      accountName: merchant.businessName,
      transactionCount: await getTransactionCount(merchantId),
      startDate: lastSettlementDate,
      endDate: new Date()
    }
  });
  
  // Debit wallet
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'SETTLEMENT',
      amount: wallet.balance,
      balanceBefore: wallet.balance,
      balanceAfter: 0,
      reference: settlement.id
    }
  });
  
  // Update wallet balance
  await prisma.merchantWallet.update({
    where: { id: wallet.id },
    data: { balance: 0 }
  });
  
  return settlement;
}
```