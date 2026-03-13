# FlowPay Sandbox Setup & First Merchant Guide

This guide walks through everything needed to set up the FlowPay sandbox environment and onboard your first merchant.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Configuration](#2-environment-configuration)
3. [MTN Sandbox Provisioning](#3-mtn-sandbox-provisioning)
4. [Merchant Registration](#4-merchant-registration)
5. [Testing Payments](#5-testing-payments)
6. [Admin Setup & Fee Management](#6-admin-setup--fee-management)
7. [Webhook Configuration](#7-webhook-configuration)
8. [Production Readiness Checklist](#8-production-readiness-checklist)

---

## 1. Prerequisites

Before starting, ensure you have:

- **Node.js** (v18+) and **npm** installed
- **PostgreSQL** database (Supabase recommended)
- **Redis** instance (for state management and job queues)
- **MTN MoMo Developer Account** — sign up at https://momodeveloper.mtn.com
- Subscription keys for the MTN products you need (Collection, Disbursement, Remittance)

### Install Dependencies

```bash
cd backend.migration
npm install          # Installs deps, runs motia install + prisma generate
npm run db:push      # Pushes Prisma schema to your database
```

---

## 2. Environment Configuration

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `JWT_SECRET` | Secret for signing JWT tokens | Use a strong random string |
| `MTN_API_URL` | MTN API base URL | `https://sandbox.momodeveloper.mtn.com` |
| `MTN_TARGET_ENVIRONMENT` | Must be `sandbox` for testing | `sandbox` |
| `MTN_SANDBOX_PROVISIONING_KEY` | Subscription key for sandbox provisioning | From MTN portal |

### Getting MTN Subscription Keys

1. Go to https://momodeveloper.mtn.com
2. Subscribe to the **Collection**, **Disbursement**, and/or **Remittance** products
3. Go to your **Profile** → copy the **Primary Key** for each product
4. Set them in your `.env`:

```env
MTN_COLLECTION_SUBSCRIPTION_KEY=<your-collection-primary-key>
MTN_DISBURSEMENT_SUBSCRIPTION_KEY=<your-disbursement-primary-key>
MTN_REMITTANCE_SUBSCRIPTION_KEY=<your-remittance-primary-key>
MTN_SANDBOX_PROVISIONING_KEY=<your-sandbox-provisioning-primary-key>
```

---

## 3. MTN Sandbox Provisioning

Before making any MTN API calls, you need to create an API user and API key in the MTN sandbox. FlowPay provides endpoints that wrap the MTN Sandbox Provisioning API.

> **Note:** These endpoints are only available when `MTN_TARGET_ENVIRONMENT=sandbox`.

### Step 1: Create a Sandbox API User

```bash
curl -X POST http://localhost:5000/api/v1/sandbox/apiuser \
  -H "Content-Type: application/json" \
  -d '{
    "providerCallbackHost": "your-domain.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "referenceId": "generated-uuid-here"
}
```

Save the `referenceId` — you'll need it for the next steps.

### Step 2: Generate an API Key

```bash
curl -X POST http://localhost:5000/api/v1/sandbox/apiuser/<referenceId>/apikey
```

**Response:**
```json
{
  "success": true,
  "referenceId": "<referenceId>",
  "apiKey": "generated-api-key-here"
}
```

### Step 3: Verify the API User

```bash
curl http://localhost:5000/api/v1/sandbox/apiuser/<referenceId>
```

**Response:**
```json
{
  "success": true,
  "referenceId": "<referenceId>",
  "providerCallbackHost": "your-domain.com",
  "targetEnvironment": "sandbox"
}
```

### Step 4: Update your `.env`

```env
MTN_API_USER=<referenceId>
MTN_API_KEY=<apiKey>
MTN_API_SECRET=<apiKey>
```

You can also use the Postman collection at `postman/01_MTN_Sandbox_Setup.postman_collection.json` which automates the above steps for Collection, Disbursement, and Remittance products.

---

## 4. Merchant Registration

### Register a New Merchant

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "username": "mymerchant",
    "password": "securepassword123",
    "businessName": "My Business",
    "phoneNumber": "+237600000000"
  }'
```

**Response:**
```json
{
  "user": {
    "id": "...",
    "email": "merchant@example.com",
    "businessName": "My Business",
    "createdAt": "..."
  },
  "token": "<jwt-token>",
  "sandboxApiKey": {
    "key": "pk_test_...",
    "name": "Default Sandbox Key",
    "mode": "sandbox",
    "message": "Your sandbox API key for testing. Use X-API-Key header to authenticate requests."
  }
}
```

The response includes:
- **JWT token** — for user-level authentication (expires in 7 days)
- **Sandbox API key** (`pk_test_...`) — for authenticating API requests

### Authenticate API Requests

Use either method:

```bash
# Option 1: JWT Bearer Token
curl -H "Authorization: Bearer <jwt-token>" ...

# Option 2: API Key (recommended for integrations)
curl -H "X-API-Key: pk_test_..." ...
```

### Create Additional API Keys

```bash
curl -X POST http://localhost:5000/api/v1/auth/api-keys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Integration Key",
    "mode": "sandbox"
  }'
```

> **Note:** Live API keys (`mode: "live"`, prefix `pk_live_`) require KYC verification (`kycStatus: VERIFIED`).

---

## 5. Testing Payments

### Create a Payment (Request to Pay)

```bash
curl -X POST http://localhost:5000/api/v1/payments \
  -H "X-API-Key: pk_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000,
    "currency": "XAF",
    "from": "237670000000",
    "provider": "MTN",
    "description": "Test payment"
  }'
```

### Check Payment Status

```bash
curl http://localhost:5000/api/v1/payments/<paymentId>/status \
  -H "X-API-Key: pk_test_..."
```

### MTN Sandbox Test Numbers

In the MTN sandbox, use these test phone numbers:
- `46733123450` — Will approve the payment
- `46733123451` — Will reject the payment
- `46733123452` — Will time out

### List Payments

```bash
curl "http://localhost:5000/api/v1/payments?page=1&limit=10" \
  -H "X-API-Key: pk_test_..."
```

---

## 6. Admin Setup & Fee Management

### Create the First Admin

Create a super admin user directly in the database (one-time setup):

```sql
UPDATE "User"
SET role = 'SUPER_ADMIN', "isVerified" = true
WHERE email = 'admin@yourdomain.com';
```

Then log in through the admin endpoint:

```bash
curl -X POST http://localhost:5000/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourdomain.com",
    "password": "your-password"
  }'
```

### Create a Fee Structure

```bash
curl -X POST http://localhost:5000/api/v1/admin/fees/structures \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Standard",
    "description": "Standard merchant fee",
    "percentage": 2.5,
    "minFee": 100,
    "maxFee": 50000,
    "fixedFee": 50,
    "isDefault": true
  }'
```

### Assign a Fee to a Merchant

```bash
curl -X POST http://localhost:5000/api/v1/admin/fees/merchants/assign \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<merchant-user-id>",
    "feeStructureId": "<fee-structure-id>",
    "notes": "First merchant onboarded"
  }'
```

---

## 7. Webhook Configuration

Merchants receive real-time notifications about transaction events via webhooks.

### Webhook Events

The following events are delivered to the merchant's configured webhook URL:

| Event | Description |
|-------|-------------|
| `payment.created` | New payment initiated |
| `payment.completed` | Payment succeeded |
| `payment.failed` | Payment failed |
| `transfer.created` | Transfer initiated |
| `transfer.completed` | Transfer succeeded |
| `transfer.failed` | Transfer failed |
| `deposit.created` | Deposit initiated |
| `deposit.completed` | Deposit succeeded |
| `deposit.failed` | Deposit failed |
| `withdrawal.created` | Withdrawal initiated |
| `withdrawal.completed` | Withdrawal succeeded |
| `withdrawal.failed` | Withdrawal failed |

### Configure Webhook URL

Update the merchant's webhook settings via the database or admin API:

```sql
UPDATE "UserSettings"
SET "webhookUrl" = 'https://your-merchant.com/webhooks',
    "webhookSecret" = 'a-strong-secret'
WHERE "userId" = '<merchant-user-id>';
```

### Webhook Payload Format

```json
{
  "event": "payment.completed",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "paymentId": "...",
    "amount": 5000,
    "currency": "XAF",
    "status": "COMPLETED",
    "provider": "MTN"
  },
  "signature": "hmac-sha256-signature"
}
```

Verify the webhook signature using the `webhookSecret` with HMAC-SHA256.

---

## 8. Production Readiness Checklist

Before onboarding your first merchant in production:

### Environment

- [ ] Set `MTN_TARGET_ENVIRONMENT=production`
- [ ] Set `MTN_API_URL` to the production MTN URL (`https://proxy.momoapi.mtn.com`)
- [ ] Use production MTN API credentials (`MTN_API_USER`, `MTN_API_KEY`, `MTN_API_SECRET`)
- [ ] Set production subscription keys for Collection, Disbursement, Remittance
- [ ] Remove or unset `MTN_SANDBOX_PROVISIONING_KEY` (not used in production)
- [ ] Set `NODE_ENV=production`
- [ ] Use a strong, unique `JWT_SECRET`
- [ ] Use a strong, unique `WEBHOOK_SECRET`

### Database

- [ ] Production PostgreSQL database with SSL enabled
- [ ] Database backups configured
- [ ] Run `npm run db:migrate` to apply all migrations

### Security

- [ ] CORS configured to allow only your frontend domain
- [ ] Rate limiting enabled and tuned
- [ ] HTTPS enforced on all endpoints
- [ ] Webhook signatures validated by merchants

### Merchant Onboarding

- [ ] Admin account created with `SUPER_ADMIN` role
- [ ] Default fee structure created and set as default
- [ ] Fee structure assigned to each merchant
- [ ] KYC verification process defined (manual or automated)
- [ ] Merchant webhook URLs configured and tested

### Monitoring

- [ ] Logging configured (production log level: `warn` or `error`)
- [ ] Webhook delivery retries monitored (3 retries by default)
- [ ] Cron jobs running (payment polling, transfer polling, webhook retries)
- [ ] Balance reconciliation scheduled

---

## Quick Start (TL;DR)

```bash
# 1. Setup
cp .env.example .env
# Edit .env with your credentials
npm install
npm run db:push

# 2. Start the server
npm run dev

# 3. Provision MTN sandbox credentials
curl -X POST http://localhost:5000/api/v1/sandbox/apiuser \
  -H "Content-Type: application/json" \
  -d '{"providerCallbackHost": "localhost"}'
# → Save the referenceId

curl -X POST http://localhost:5000/api/v1/sandbox/apiuser/<referenceId>/apikey
# → Save the apiKey, update .env with MTN_API_USER and MTN_API_KEY

# 4. Register your first merchant
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@example.com",
    "username": "merchant1",
    "password": "password123",
    "businessName": "First Merchant"
  }'
# → Save the JWT token and sandbox API key

# 5. Make a test payment
curl -X POST http://localhost:5000/api/v1/payments \
  -H "X-API-Key: pk_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "XAF",
    "from": "46733123450",
    "provider": "MTN",
    "description": "Test"
  }'
```
