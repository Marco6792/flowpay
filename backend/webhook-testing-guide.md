# FlowPay Webhook Testing Guide

## Option 1: Using webhook.site (No signup needed)

1. **Go to https://webhook.site**
2. **Copy your unique URL** (e.g., `https://webhook.site/12345678-abcd-1234-5678-123456789abc`)
3. **Test MTN webhook with our test endpoint**:

```bash
# Test webhook processing
curl -X POST http://localhost:3000/api/v1/webhooks/test \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "your-payment-id",
    "status": "SUCCESSFUL",
    "provider": "mtn"
  }'
```

## Option 2: Using ngrok (Requires free account)

1. **Sign up**: https://dashboard.ngrok.com/signup
2. **Get authtoken**: https://dashboard.ngrok.com/get-started/your-authtoken
3. **Configure**:
```bash
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
ngrok http 3000
```
4. **Use the https URL** ngrok provides (e.g., `https://abc123.ngrok.io`)

## Option 3: Configure MTN Callback URL

Update your environment variables:

```bash
# .env file
MTN_CALLBACK_URL=https://your-ngrok-url.ngrok.io/api/v1/webhooks/mtn
# or
MTN_CALLBACK_URL=https://webhook.site/your-unique-id
```

## FlowPay Webhook Endpoints Already Available:

- `POST /api/v1/webhooks/mtn` - Receive MTN callbacks
- `POST /api/v1/webhooks/test` - Test webhook processing
- `POST /api/v1/webhooks/notify` - Send to your apps

## MTN Sandbox Webhook Testing:

MTN Sandbox doesn't actually send webhooks automatically. For testing:

1. **Use our test endpoint**
2. **Manually trigger status updates**
3. **Simulate webhook payloads**

## Example Test Webhook:

```json
{
  "financialTransactionId": "12345",
  "externalId": "your-payment-id",
  "amount": "100",
  "currency": "EUR",
  "payer": {
    "partyIdType": "MSISDN",
    "partyId": "46733123453"
  },
  "status": "SUCCESSFUL"
}
```