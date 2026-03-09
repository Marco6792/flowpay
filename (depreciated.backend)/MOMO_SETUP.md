# MTN MoMo API Setup Guide

This guide will help you set up MTN Mobile Money (MoMo) API integration for FlowPay.

## Prerequisites

1. MTN MoMo Developer Account
2. Subscription keys for the required products
3. API credentials (API User and API Key)

## Step 1: Create Developer Account

1. Sign up at [https://momodeveloper.mtn.com](https://momodeveloper.mtn.com)
2. Verify your email address
3. Complete your profile

## Step 2: Subscribe to Products

Navigate to the [Products page](https://momodeveloper.mtn.com/Product-descriptions) and subscribe to the products you need:

- **Collections**: For receiving payments from customers
- **Disbursements**: For sending money to customers (payouts, refunds)
- **Remittance**: For international money transfers

Each product will generate a unique subscription key.

## Step 3: Get Subscription Keys

1. Go to [your profile](https://momodeveloper.mtn.com/profile)
2. Find your subscription keys for each product you subscribed to
3. Copy the Primary Key for each product

## Step 4: Generate API User and Key (Sandbox Only)

For sandbox testing, you need to generate an API User and API Key. Use the Postman collection or the following API calls:

### Create API User
```bash
curl -X POST https://sandbox.momodeveloper.mtn.com/v1_0/apiuser \
  -H "X-Reference-Id: <UUID>" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: <YOUR_SUBSCRIPTION_KEY>" \
  -d '{
    "providerCallbackHost": "your-domain.com"
  }'
```

### Generate API Key
```bash
curl -X POST https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/<API_USER_ID>/apikey \
  -H "Ocp-Apim-Subscription-Key: <YOUR_SUBSCRIPTION_KEY>"
```

## Step 5: Configure Environment Variables

Create a `.env` file in the backend directory and add the following variables:

```env
# MTN MoMo API Configuration
MTN_API_URL=https://sandbox.momodeveloper.mtn.com
MTN_TARGET_ENVIRONMENT=sandbox

# API Credentials
MTN_API_USER=<YOUR_API_USER_ID>
MTN_API_KEY=<YOUR_API_KEY>
MTN_API_SECRET=<YOUR_API_SECRET>

# Subscription Keys
MTN_COLLECTION_SUBSCRIPTION_KEY=<YOUR_COLLECTION_KEY>
MTN_DISBURSEMENT_SUBSCRIPTION_KEY=<YOUR_DISBURSEMENT_KEY>
MTN_REMITTANCE_SUBSCRIPTION_KEY=<YOUR_REMITTANCE_KEY>

# Callback Configuration
MTN_CALLBACK_URL=https://your-domain.com/api/v1/webhooks/mtn
MTN_PROVIDER_CALLBACK_HOST=your-domain.com
```

## Step 6: Test Numbers (Sandbox)

Use these test numbers in the sandbox environment:

| Phone Number | Expected Response |
|-------------|------------------|
| 46733123450 | Failed |
| 46733123451 | Rejected |
| 46733123452 | Timeout |
| 56733123453 | Success |
| 46733123454 | Pending |

## Production Configuration

For production deployment:

1. Update `MTN_TARGET_ENVIRONMENT` to `production`
2. Change `MTN_API_URL` to the production URL (varies by country):
   - General: `https://proxy.momoapi.mtn.com`
   - Country-specific URLs may apply
3. Use real API credentials provided by MTN
4. Update callback URLs to your production domain

## API Operations

The current implementation supports:

### Collections (Implemented)
- Request to Pay: Accept payments from customers
- Check Payment Status: Verify transaction status

### Disbursements (To be implemented)
- Transfer: Send money to recipients
- Refund: Process refunds to customers

### Remittance (To be implemented)
- Transfer: International money transfers
- Cash Transfer: Cash-based transfers

## Testing the Integration

1. Start the backend server:
```bash
npm run dev
```

2. Use the payment endpoints:
```bash
# Initiate a payment
POST /api/v1/payments
{
  "amount": 1000,
  "currency": "XAF",
  "from": "56733123453",
  "to": "merchant",
  "provider": "mtn",
  "description": "Test payment"
}

# Check payment status
GET /api/v1/payments/{transactionId}/status
```

## Troubleshooting

### Common Issues

1. **Invalid credentials**: Verify your API User, API Key, and subscription keys
2. **404 Not Found**: Check that you're using the correct base URL for your environment
3. **Unauthorized**: Ensure your subscription key matches the product you're calling
4. **Timeout**: The sandbox may have slower response times; increase timeout values

### Debug Mode

Enable debug logging by setting:
```env
LOG_LEVEL=debug
```

## Resources

- [MoMo Developer Portal](https://momodeveloper.mtn.com)
- [API Documentation](https://momodeveloper.mtn.com/api-documentation)
- [Developer Community](https://momodevelopercommunity.mtn.com)
- [Postman Collection](./MoMo%20Open%20APIs%20SandBox.postman_collection.json)

## Support

For API-related issues, contact MTN MoMo support through the developer portal.
For FlowPay integration issues, check the logs and ensure all environment variables are correctly configured.