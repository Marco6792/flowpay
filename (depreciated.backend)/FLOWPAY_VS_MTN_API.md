# FlowPay vs Direct MTN MoMo API

## Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Merchant   │────▶│   FlowPay    │────▶│  MTN MoMo    │
│  Application │     │   Backend    │     │     API      │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Orange Money │
                     │     API      │
                     └──────────────┘
```

## Key Differences

### 1. **FlowPay API (Payment Aggregator)**
- **Purpose**: Unified payment gateway for multiple providers
- **Benefits**:
  - Single API for multiple payment providers (MTN, Orange, etc.)
  - Consistent request/response format
  - Built-in error handling and retry logic
  - Transaction tracking and reconciliation
  - Webhook management
  - API key management per merchant

### 2. **Direct MTN MoMo API**
- **Purpose**: Direct integration with MTN Mobile Money
- **Benefits**:
  - Full access to all MTN features
  - Lower latency (no middleman)
  - Direct control over API calls
- **Drawbacks**:
  - Need separate integrations for each provider
  - Handle authentication, tokens, errors yourself
  - Manage different API formats per provider

## Real-World Example: E-Commerce Payment Flow

### Scenario: Customer buying goods worth 5,000 XAF

---

## Option 1: Using FlowPay API

### Step 1: Merchant Registers with FlowPay
```bash
POST http://localhost:5000/api/v1/auth/register
{
  "email": "merchant@shop.com",
  "password": "secure_password",
  "businessName": "My Online Shop"
}

# Response
{
  "apiKey": "flp_live_abc123...",
  "merchantId": "merchant_001"
}
```

### Step 2: Customer Initiates Payment
```bash
# Merchant's backend calls FlowPay
POST http://localhost:5000/api/v1/payments
Headers: 
  X-API-Key: flp_live_abc123...

{
  "amount": 5000,
  "currency": "XAF",
  "from": "237670123456",  # Customer's phone
  "provider": "mtn",       # or "orange"
  "description": "Order #12345",
  "callbackUrl": "https://shop.com/payment-callback"
}

# FlowPay Response
{
  "transactionId": "flp_txn_789xyz",
  "status": "pending",
  "message": "Payment initiated. Waiting for customer approval."
}
```

### Step 3: FlowPay Handles Provider Logic
```javascript
// Inside FlowPay (automated)
1. FlowPay validates merchant API key
2. FlowPay selects MTN provider
3. FlowPay gets MTN access token
4. FlowPay formats request for MTN API
5. FlowPay calls MTN requesttopay
6. FlowPay stores transaction details
```

### Step 4: Customer Approves on Phone
```
Customer receives USSD prompt:
"Confirm payment of 5,000 XAF to My Online Shop?"
[1] Confirm  [2] Cancel
```

### Step 5: FlowPay Sends Webhook
```bash
# FlowPay → Merchant webhook
POST https://shop.com/payment-callback
{
  "transactionId": "flp_txn_789xyz",
  "status": "completed",
  "amount": 5000,
  "provider": "mtn",
  "providerTransactionId": "mtn_ref_123",
  "timestamp": "2025-01-12T10:30:00Z"
}
```

### Step 6: Merchant Confirms Order
```javascript
// Merchant's backend
if (webhook.status === 'completed') {
  // Mark order as paid
  // Send confirmation email
  // Trigger shipping
}
```

---

## Option 2: Direct MTN MoMo API Integration

### Step 1: Merchant Gets MTN Credentials
```bash
# Register at https://momodeveloper.mtn.com
# Get subscription keys
# Generate API user and key (sandbox)
```

### Step 2: Merchant Gets Access Token
```bash
# Merchant must implement this
POST https://sandbox.momodeveloper.mtn.com/collection/token/
Headers:
  Authorization: Basic base64(apiuser:apikey)
  Ocp-Apim-Subscription-Key: 4c91dae7a6f1474387a23a1f3d448eb7

# Response
{
  "access_token": "eyJ0eXAiOiJKV1...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### Step 3: Merchant Initiates Payment
```bash
POST https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay
Headers:
  Authorization: Bearer eyJ0eXAiOiJKV1...
  X-Reference-Id: unique-uuid-here
  X-Target-Environment: sandbox
  Ocp-Apim-Subscription-Key: 4c91dae7a6f1474387a23a1f3d448eb7
  X-Callback-Url: https://shop.com/mtn-callback

{
  "amount": "5000",
  "currency": "XAF",
  "externalId": "order_12345",
  "payer": {
    "partyIdType": "MSISDN",
    "partyId": "237670123456"
  },
  "payerMessage": "Payment for Order #12345",
  "payeeNote": "Thank you for your purchase"
}

# Response: 202 Accepted (no body)
```

### Step 4: Merchant Checks Status
```bash
# Merchant must poll or wait for callback
GET https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/{referenceId}
Headers:
  Authorization: Bearer eyJ0eXAiOiJKV1...
  X-Target-Environment: sandbox
  Ocp-Apim-Subscription-Key: 4c91dae7a6f1474387a23a1f3d448eb7

# Response
{
  "status": "SUCCESSFUL",
  "amount": "5000",
  "currency": "XAF",
  "financialTransactionId": "mtn_internal_ref",
  "externalId": "order_12345",
  "payer": {
    "partyIdType": "MSISDN",
    "partyId": "237670123456"
  }
}
```

### Step 5: Merchant Handles Multiple Providers
```javascript
// For Orange Money, completely different integration:
// Different auth flow
// Different API endpoints
// Different request format
// Different error codes
```

---

## Comparison Table

| Feature | FlowPay API | Direct MTN API |
|---------|------------|----------------|
| **Integration Effort** | Single API for all providers | Separate for each provider |
| **Authentication** | One API key | Multiple credentials per provider |
| **Request Format** | Unified JSON format | Provider-specific formats |
| **Error Handling** | Standardized errors | Provider-specific error codes |
| **Token Management** | Handled by FlowPay | Manual token refresh |
| **Webhook Format** | Consistent across providers | Different per provider |
| **Testing** | Single sandbox | Multiple sandboxes |
| **Monitoring** | Centralized dashboard | Multiple dashboards |
| **Reconciliation** | Built-in reports | Manual reconciliation |
| **Provider Switching** | Change one parameter | Rewrite integration |

---

## Code Examples

### FlowPay Integration (Simple)
```javascript
// merchant-backend.js
const FlowPayClient = {
  async pay(amount, phone, provider) {
    return fetch('http://flowpay.com/api/v1/payments', {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.FLOWPAY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,
        from: phone,
        provider, // 'mtn' or 'orange'
        currency: 'XAF'
      })
    });
  }
};

// Usage - works for ANY provider
await FlowPayClient.pay(5000, '237670123456', 'mtn');
await FlowPayClient.pay(5000, '237690123456', 'orange');
```

### Direct MTN Integration (Complex)
```javascript
// mtn-integration.js
class MTNClient {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
  }

  async getToken() {
    if (this.token && this.tokenExpiry > Date.now()) {
      return this.token;
    }
    
    const response = await fetch('https://sandbox.momodeveloper.mtn.com/collection/token/', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${API_USER}:${API_KEY}`).toString('base64')}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
      }
    });
    
    const data = await response.json();
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    return this.token;
  }

  async requestPayment(amount, phone) {
    const token = await this.getToken();
    const referenceId = uuid();
    
    await fetch('https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': 'sandbox',
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount.toString(),
        currency: 'XAF',
        externalId: generateOrderId(),
        payer: {
          partyIdType: 'MSISDN',
          partyId: phone
        },
        payerMessage: 'Payment request',
        payeeNote: 'Thank you'
      })
    });
    
    // Now need to poll for status...
    return this.checkStatus(referenceId);
  }

  async checkStatus(referenceId) {
    // Implement polling logic
    // Handle different status codes
    // Retry on failure
    // etc...
  }
}

// For Orange, need completely different class...
class OrangeClient {
  // Different auth method
  // Different endpoints
  // Different request format
}
```

---

## Recommendations

### Use FlowPay When:
- You need multiple payment providers
- You want quick integration
- You need unified reporting
- You want to focus on your business logic
- You need consistent error handling
- You want built-in retry logic

### Use Direct MTN API When:
- You only need MTN payments
- You need specific MTN features not in FlowPay
- You want maximum control
- You have resources for complex integration
- You need the lowest possible latency

---

## FlowPay Value Proposition

1. **Time to Market**: Days vs Weeks
2. **Maintenance**: One integration vs Multiple
3. **Provider Flexibility**: Easy to add/switch providers
4. **Business Intelligence**: Unified analytics
5. **Compliance**: Single point for regulatory requirements
6. **Support**: One contact for all payment issues

## Cost Comparison

### FlowPay
- Small transaction fee (e.g., 1-2%)
- No setup costs
- No maintenance costs
- Includes support

### Direct Integration
- No middleman fees
- High development costs
- Ongoing maintenance costs
- Multiple support contracts

---

## Conclusion

FlowPay acts as a **payment orchestration layer** that:
- Abstracts provider complexity
- Provides unified interface
- Handles technical details
- Enables provider portability
- Reduces integration effort

It's like using Stripe/PayPal instead of integrating directly with each bank's API.