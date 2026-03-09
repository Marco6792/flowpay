# FlowPay Backend Migration: Fastify → Motia

## Overview

Migrate the FlowPay payment gateway backend from Fastify 4.25 to Motia framework (~0.9.6-beta). The migration converts ~50 HTTP routes across 9 route modules into auto-discovered Motia `.step.ts` files, replaces Fastify middleware with Motia middleware functions, and introduces event-driven patterns for webhook forwarding and background processing.

**What stays**: Prisma ORM, PostgreSQL, Redis, all 15 service files, provider implementations (MTN/Orange), env config, utilities, Docker infrastructure.

**What goes**: Fastify app setup, route registration, Fastify plugins (@fastify/cors, jwt, helmet, rate-limit), `src/index.ts` entry point.

**What's new**: Motia runtime, `.step.ts` files per endpoint, Motia middleware, event steps for async processing, cron steps for scheduled jobs.

---

## Phase 1: Project Setup & Infrastructure

### 1.1 Initialize Motia in the backend directory

```bash
cd backend
# Install Motia dependencies
npm install motia @motiadev/core @motiadev/plugin-endpoint @motiadev/plugin-logs @motiadev/plugin-observability @motiadev/plugin-states

# Remove Fastify dependencies
npm uninstall fastify @fastify/cors @fastify/helmet @fastify/rate-limit @fastify/formbody @fastify/jwt
```

### 1.2 Create `motia.config.ts`

```typescript
import { config } from '@motiadev/core'
const statesPlugin = require('@motiadev/plugin-states/plugin')
const endpointPlugin = require('@motiadev/plugin-endpoint/plugin')
const logsPlugin = require('@motiadev/plugin-logs/plugin')
const observabilityPlugin = require('@motiadev/plugin-observability/plugin')

export default config({
  plugins: [observabilityPlugin, statesPlugin, endpointPlugin, logsPlugin],
})
```

### 1.3 Update `package.json` scripts

```json
{
  "scripts": {
    "postinstall": "motia install && prisma generate",
    "dev": "motia dev",
    "build": "motia build",
    "start": "motia start",
    "generate-types": "motia generate-types",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push"
  }
}
```

### 1.4 Create type augmentation file `src/api.d.ts`

Extend Motia's `ApiRequest` to carry auth context (same as Fastify's `request.user` / `request.apiKey`).

### 1.5 Update Dockerfile

Replace `bun run dev` with `motia dev` (dev) / `motia start` (prod).

---

## Phase 2: Middleware Migration

### 2.1 Auth Middleware → `src/middleware/auth.middleware.ts`

Convert Fastify's global `preHandler` auth hook into a reusable Motia `ApiMiddleware`:

- **JWT auth**: Check `Authorization: Bearer <token>`, verify with jsonwebtoken, attach user to `req`
- **API Key auth**: Check `X-API-Key` header, look up in DB via Prisma, attach apiKey + user to `req`
- Export two middleware functions: `jwtAuth` and `apiKeyAuth`

### 2.2 Admin Middleware → `src/middleware/admin.middleware.ts`

Convert `requireAdmin` and `requireSuperAdmin` to Motia `ApiMiddleware` functions.

### 2.3 Validation Middleware → `src/middleware/validation.middleware.ts`

Zod validation is natively supported via `bodySchema` in Motia step config. No custom middleware needed for most cases.

---

## Phase 3: API Step Files (Route-by-Route Conversion)

Each Fastify route becomes a `.step.ts` file. Organization: `src/steps/<domain>/`.

### 3.1 Health (`src/steps/health/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `health-check.step.ts` | GET | `/api/v1/health` | None | [] |

### 3.2 Auth (`src/steps/auth/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `register.step.ts` | POST | `/api/v1/auth/register` | None | ['user.registered'] |
| `login.step.ts` | POST | `/api/v1/auth/login` | None | [] |
| `create-api-key.step.ts` | POST | `/api/v1/auth/api-keys` | JWT | ['apikey.created'] |
| `list-api-keys.step.ts` | GET | `/api/v1/auth/api-keys` | JWT | [] |
| `revoke-api-key.step.ts` | DELETE | `/api/v1/auth/api-keys/:id` | JWT | ['apikey.revoked'] |

### 3.3 Payments (`src/steps/payments/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `create-payment.step.ts` | POST | `/api/v1/payments` | API Key | ['payment.created'] |
| `get-payment.step.ts` | GET | `/api/v1/payments/:transactionId` | API Key | [] |
| `list-payments.step.ts` | GET | `/api/v1/payments` | API Key | [] |
| `get-payment-stats.step.ts` | GET | `/api/v1/payments/stats` | API Key | [] |
| `cancel-payment.step.ts` | POST | `/api/v1/payments/:transactionId/cancel` | API Key | ['payment.cancelled'] |
| `send-notification.step.ts` | POST | `/api/v1/payments/:id/notify` | API Key | ['notification.sent'] |
| `create-refund.step.ts` | POST | `/api/v1/payments/:id/refund` | API Key | ['refund.created'] |
| `get-refund-status.step.ts` | GET | `/api/v1/refunds/:refundId/status` | API Key | [] |
| `list-refunds.step.ts` | GET | `/api/v1/payments/:id/refunds` | API Key | [] |

### 3.4 Withdrawals via Payment Controller (`src/steps/withdraw/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `request-withdraw.step.ts` | POST | `/api/v1/withdraw` | API Key | ['withdraw.requested'] |
| `get-withdraw-status.step.ts` | GET | `/api/v1/withdraw/:withdrawId` | API Key | [] |

### 3.5 Transfers (`src/steps/transfers/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `create-transfer.step.ts` | POST | `/api/v1/transfers` | API Key | ['transfer.created'] |
| `get-transfer.step.ts` | GET | `/api/v1/transfers/:transferId` | API Key | [] |
| `get-transfer-status.step.ts` | GET | `/api/v1/transfers/:transferId/status` | API Key | [] |
| `list-transfers.step.ts` | GET | `/api/v1/transfers` | API Key | [] |

### 3.6 Account (`src/steps/account/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `get-account-balance.step.ts` | GET | `/api/v1/account/balance` | API Key | [] |
| `validate-recipient.step.ts` | POST | `/api/v1/account/validate` | API Key | [] |
| `get-user-info.step.ts` | POST | `/api/v1/account/userinfo` | API Key | [] |

### 3.7 Deposits (`src/steps/deposits/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `create-deposit.step.ts` | POST | `/api/v1/deposits` | API Key | ['deposit.created'] |
| `get-deposit-status.step.ts` | GET | `/api/v1/deposits/:depositId/status` | API Key | [] |

### 3.8 Withdrawals (dedicated) (`src/steps/withdrawals/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `create-withdrawal.step.ts` | POST | `/api/v1/withdrawals` | API Key | ['withdrawal.created'] |
| `get-withdrawal.step.ts` | GET | `/api/v1/withdrawals/:withdrawId` | API Key | [] |
| `get-withdrawal-status.step.ts` | GET | `/api/v1/withdrawals/:withdrawId/status` | API Key | [] |
| `list-withdrawals.step.ts` | GET | `/api/v1/withdrawals` | API Key | [] |

### 3.9 Balance (`src/steps/balance/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `get-aggregated-balance.step.ts` | GET | `/api/v1/balance/aggregated` | API Key | [] |
| `get-wallet-balances.step.ts` | GET | `/api/v1/balance/wallets` | API Key | [] |
| `get-provider-balances.step.ts` | GET | `/api/v1/balance/providers` | API Key | [] |
| `get-provider-balance.step.ts` | GET | `/api/v1/balance/provider/:provider` | API Key | [] |
| `refresh-balance.step.ts` | POST | `/api/v1/balance/refresh` | API Key | ['balance.refresh.requested'] |
| `get-transaction-history.step.ts` | GET | `/api/v1/balance/transactions` | API Key | [] |

### 3.10 Consent / OAuth2 (`src/steps/consent/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `create-consent.step.ts` | POST | `/api/v1/consent` | Optional | ['consent.created'] |
| `create-subscription-consent.step.ts` | POST | `/api/v1/consent/subscription` | Optional | ['consent.created'] |
| `create-bill-payment-consent.step.ts` | POST | `/api/v1/consent/bill-payment` | Optional | ['consent.created'] |
| `create-account-access-consent.step.ts` | POST | `/api/v1/consent/account-access` | Optional | ['consent.created'] |
| `get-token-from-consent.step.ts` | GET | `/api/v1/consent/token/:authReqId` | Optional | [] |
| `get-user-info-from-token.step.ts` | POST | `/api/v1/consent/userinfo` | Optional | [] |
| `refresh-token.step.ts` | POST | `/api/v1/consent/refresh` | Optional | [] |
| `revoke-consent.step.ts` | POST | `/api/v1/consent/revoke` | Optional | ['consent.revoked'] |
| `get-basic-user-info.step.ts` | GET | `/api/v1/user/basic/:msisdn` | Optional | [] |

### 3.11 Webhooks (`src/steps/webhooks/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `mtn-webhook.step.ts` | POST | `/api/v1/webhooks/mtn` | None (signature) | ['webhook.mtn.received'] |
| `orange-webhook.step.ts` | POST | `/api/v1/webhooks/orange` | None (signature) | ['webhook.orange.received'] |
| `provider-webhook.step.ts` | POST | `/api/v1/webhooks/provider/:provider` | None | ['webhook.provider.received'] |
| `test-webhook.step.ts` | POST | `/api/v1/webhooks/test` | None | ['webhook.test.received'] |
| `configure-webhook.step.ts` | POST | `/api/v1/webhooks/configure` | API Key | ['webhook.configured'] |
| `get-webhook-status.step.ts` | GET | `/api/v1/webhooks/status` | API Key | [] |
| `webhook-stream.step.ts` | GET | `/api/v1/webhooks/stream` | API Key | [] |
| `list-deliveries.step.ts` | GET | `/api/v1/webhooks/deliveries` | API Key | [] |
| `get-delivery.step.ts` | GET | `/api/v1/webhooks/deliveries/:id` | API Key | [] |
| `replay-delivery.step.ts` | POST | `/api/v1/webhooks/deliveries/:id/replay` | API Key | ['webhook.replay.requested'] |
| `notify-webhook.step.ts` | POST | `/api/v1/webhooks/notify` | API Key | ['webhook.notification.queued'] |

### 3.12 Fees (`src/steps/fees/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `create-fee-structure.step.ts` | POST | `/api/v1/fees` | Admin | ['fee.created'] |
| `update-fee-structure.step.ts` | PUT | `/api/v1/fees/:id` | Admin | ['fee.updated'] |
| `list-fee-structures.step.ts` | GET | `/api/v1/fees` | Admin | [] |
| `assign-merchant-fee.step.ts` | POST | `/api/v1/fees/assign` | Admin | ['fee.assigned'] |
| `get-merchant-fee-history.step.ts` | GET | `/api/v1/fees/merchant/:merchantId/history` | Admin | [] |
| `calculate-fee.step.ts` | POST | `/api/v1/fees/calculate` | API Key | [] |
| `get-merchant-current-fee.step.ts` | GET | `/api/v1/fees/merchant/:merchantId` | API Key | [] |
| `create-volume-tier.step.ts` | POST | `/api/v1/fees/tiers` | Admin | ['fee.tier.created'] |
| `get-revenue-report.step.ts` | GET | `/api/v1/fees/revenue` | Admin | [] |

### 3.13 Admin Auth (`src/steps/admin/`)

| File | Method | Path | Auth | Emits |
|------|--------|------|------|-------|
| `admin-login.step.ts` | POST | `/api/v1/admin/auth/login` | None | [] |
| `get-current-admin.step.ts` | GET | `/api/v1/admin/auth/me` | JWT+Admin | [] |
| `create-admin.step.ts` | POST | `/api/v1/admin/auth/create-admin` | JWT+SuperAdmin | ['admin.created'] |

---

## Phase 4: Event Steps (Async Processing)

These event steps subscribe to topics emitted by API steps and handle background processing.

### 4.1 Webhook Forwarding (`src/steps/events/`)

| File | Subscribes | Emits | Purpose |
|------|-----------|-------|---------|
| `process-mtn-webhook.step.ts` | ['webhook.mtn.received'] | ['payment.updated', 'transfer.updated', 'deposit.updated', 'withdrawal.updated'] | Parse MTN callback, identify entity type, update DB status, forward to merchant webhook |
| `process-orange-webhook.step.ts` | ['webhook.orange.received'] | ['payment.updated', 'transfer.updated'] | Parse Orange callback, update DB status |
| `forward-webhook.step.ts` | ['payment.updated', 'transfer.updated', 'deposit.updated', 'withdrawal.updated'] | ['webhook.delivered', 'webhook.delivery.failed'] | Deliver webhook to merchant's configured URL with retry |

### 4.2 Payment Lifecycle (`src/steps/events/`)

| File | Subscribes | Emits | Purpose |
|------|-----------|-------|---------|
| `process-payment-created.step.ts` | ['payment.created'] | ['payment.submitted'] | Submit payment to provider (MTN/Orange) |
| `audit-payment.step.ts` | ['payment.created', 'payment.updated', 'payment.cancelled'] | [] | Write audit log entries |

### 4.3 Notification Events (`src/steps/events/`)

| File | Subscribes | Emits | Purpose |
|------|-----------|-------|---------|
| `send-sms-notification.step.ts` | ['notification.sent'] | [] | Send SMS via provider |
| `process-webhook-notification.step.ts` | ['webhook.notification.queued'] | ['webhook.delivered'] | Process queued webhook notifications |

---

## Phase 5: Cron Steps (Scheduled Jobs)

| File | Schedule | Purpose |
|------|----------|---------|
| `poll-pending-payments.step.ts` | `*/2 * * * *` (every 2 min) | Poll provider APIs for status updates on PENDING/PROCESSING payments |
| `reconciliation.step.ts` | `0 2 * * *` (daily 2 AM) | Run daily reconciliation between local DB and provider records |
| `cleanup-expired-sessions.step.ts` | `0 */6 * * *` (every 6h) | Clean up expired OAuth2 tokens and stale sessions |
| `retry-failed-webhooks.step.ts` | `*/5 * * * *` (every 5 min) | Retry failed webhook deliveries |

---

## Phase 6: Cleanup

### 6.1 Remove old Fastify files
- `src/app.ts` → DELETE
- `src/index.ts` → DELETE
- `src/routes/` → DELETE entire directory
- `src/controllers/` → DELETE entire directory (logic moved into step handlers)
- `src/middleware/auth.ts` → REPLACE with Motia middleware

### 6.2 Keep unchanged
- `src/services/` → All 15 service files stay as-is
- `src/services/providers/` → MTN, Orange, factory stay as-is
- `src/config/env.ts` → Keep as-is
- `src/utils/database.ts` → Keep as-is
- `src/utils/logger.ts` → Keep (Motia has its own logger but Pino is still useful for services)
- `prisma/` → Schema + migrations unchanged
- `docker-compose.yml` → PostgreSQL + Redis stay as-is

### 6.3 Update Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## New Directory Structure

```
backend/
├── motia.config.ts                    # NEW - Motia configuration
├── package.json                       # UPDATED - new deps/scripts
├── Dockerfile                         # UPDATED - motia start
├── docker-compose.yml                 # UNCHANGED
├── prisma/
│   └── schema.prisma                  # UNCHANGED
├── src/
│   ├── api.d.ts                       # NEW - request type augmentation
│   ├── config/
│   │   └── env.ts                     # UNCHANGED
│   ├── middleware/
│   │   ├── auth.middleware.ts          # NEW - Motia ApiMiddleware (JWT + API Key)
│   │   └── admin.middleware.ts         # NEW - Motia ApiMiddleware (admin roles)
│   ├── services/                      # UNCHANGED - all 15 service files
│   │   ├── payment.service.ts
│   │   ├── transfer.service.ts
│   │   ├── withdrawal.service.ts
│   │   ├── preapproval.service.ts
│   │   ├── deposit.service.ts
│   │   ├── balance.service.ts
│   │   ├── fee.service.ts
│   │   ├── webhook.service.ts
│   │   ├── consent.service.ts
│   │   ├── wallet.service.ts
│   │   ├── polling.service.ts
│   │   ├── reconciliation.service.ts
│   │   ├── cache.service.ts
│   │   ├── audit.service.ts
│   │   ├── refund-error.service.ts
│   │   └── providers/
│   │       ├── provider.interface.ts
│   │       ├── provider.factory.ts
│   │       ├── mtn.provider.ts
│   │       └── orange.provider.ts
│   ├── utils/
│   │   ├── database.ts                # UNCHANGED
│   │   ├── logger.ts                  # UNCHANGED
│   │   └── validation.ts             # UNCHANGED
│   └── steps/                         # NEW - all Motia step files
│       ├── health/
│       │   └── health-check.step.ts
│       ├── auth/
│       │   ├── register.step.ts
│       │   ├── login.step.ts
│       │   ├── create-api-key.step.ts
│       │   ├── list-api-keys.step.ts
│       │   └── revoke-api-key.step.ts
│       ├── payments/
│       │   ├── create-payment.step.ts
│       │   ├── get-payment.step.ts
│       │   ├── list-payments.step.ts
│       │   ├── get-payment-stats.step.ts
│       │   ├── cancel-payment.step.ts
│       │   ├── send-notification.step.ts
│       │   ├── create-refund.step.ts
│       │   ├── get-refund-status.step.ts
│       │   └── list-refunds.step.ts
│       ├── withdraw/
│       │   ├── request-withdraw.step.ts
│       │   └── get-withdraw-status.step.ts
│       ├── transfers/
│       │   ├── create-transfer.step.ts
│       │   ├── get-transfer.step.ts
│       │   ├── get-transfer-status.step.ts
│       │   └── list-transfers.step.ts
│       ├── account/
│       │   ├── get-account-balance.step.ts
│       │   ├── validate-recipient.step.ts
│       │   └── get-user-info.step.ts
│       ├── deposits/
│       │   ├── create-deposit.step.ts
│       │   └── get-deposit-status.step.ts
│       ├── withdrawals/
│       │   ├── create-withdrawal.step.ts
│       │   ├── get-withdrawal.step.ts
│       │   ├── get-withdrawal-status.step.ts
│       │   └── list-withdrawals.step.ts
│       ├── balance/
│       │   ├── get-aggregated-balance.step.ts
│       │   ├── get-wallet-balances.step.ts
│       │   ├── get-provider-balances.step.ts
│       │   ├── get-provider-balance.step.ts
│       │   ├── refresh-balance.step.ts
│       │   └── get-transaction-history.step.ts
│       ├── consent/
│       │   ├── create-consent.step.ts
│       │   ├── create-subscription-consent.step.ts
│       │   ├── create-bill-payment-consent.step.ts
│       │   ├── create-account-access-consent.step.ts
│       │   ├── get-token-from-consent.step.ts
│       │   ├── get-user-info-from-token.step.ts
│       │   ├── refresh-token.step.ts
│       │   ├── revoke-consent.step.ts
│       │   └── get-basic-user-info.step.ts
│       ├── webhooks/
│       │   ├── mtn-webhook.step.ts
│       │   ├── orange-webhook.step.ts
│       │   ├── provider-webhook.step.ts
│       │   ├── test-webhook.step.ts
│       │   ├── configure-webhook.step.ts
│       │   ├── get-webhook-status.step.ts
│       │   ├── webhook-stream.step.ts
│       │   ├── list-deliveries.step.ts
│       │   ├── get-delivery.step.ts
│       │   ├── replay-delivery.step.ts
│       │   └── notify-webhook.step.ts
│       ├── fees/
│       │   ├── create-fee-structure.step.ts
│       │   ├── update-fee-structure.step.ts
│       │   ├── list-fee-structures.step.ts
│       │   ├── assign-merchant-fee.step.ts
│       │   ├── get-merchant-fee-history.step.ts
│       │   ├── calculate-fee.step.ts
│       │   ├── get-merchant-current-fee.step.ts
│       │   ├── create-volume-tier.step.ts
│       │   └── get-revenue-report.step.ts
│       ├── admin/
│       │   ├── admin-login.step.ts
│       │   ├── get-current-admin.step.ts
│       │   └── create-admin.step.ts
│       ├── events/
│       │   ├── process-mtn-webhook.step.ts
│       │   ├── process-orange-webhook.step.ts
│       │   ├── forward-webhook.step.ts
│       │   ├── process-payment-created.step.ts
│       │   ├── audit-payment.step.ts
│       │   ├── send-sms-notification.step.ts
│       │   └── process-webhook-notification.step.ts
│       └── cron/
│           ├── poll-pending-payments.step.ts
│           ├── reconciliation.step.ts
│           ├── cleanup-expired-sessions.step.ts
│           └── retry-failed-webhooks.step.ts
```

---

## Migration Order (Implementation Sequence)

1. **Phase 1** - Project setup, install deps, create config files
2. **Phase 2** - Auth & admin middleware
3. **Phase 3.1** - Health check step (verify Motia is working)
4. **Phase 3.2** - Auth steps (register, login, api-keys)
5. **Phase 3.3** - Payment steps (core business logic)
6. **Phase 3.4-3.8** - Transfer, deposit, withdrawal, balance steps
7. **Phase 3.9** - Consent/OAuth2 steps
8. **Phase 3.10-3.11** - Webhook + fee steps
9. **Phase 3.12** - Admin steps
10. **Phase 4** - Event steps (webhook processing, payment lifecycle)
11. **Phase 5** - Cron steps (polling, reconciliation)
12. **Phase 6** - Delete old Fastify files, update Dockerfile

---

## Step File Template (for reference)

```typescript
// Example: src/steps/payments/create-payment.step.ts
import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { PaymentService } from '../../services/payment.service'

const bodySchema = z.object({
  from: z.string(),
  to: z.string(),
  amount: z.number().positive(),
  currency: z.string().optional(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
  description: z.string().optional(),
  callbackUrl: z.string().url().optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreatePayment',
  type: 'api',
  path: '/api/v1/payments',
  method: 'POST',
  description: 'Create a new payment transaction',
  bodySchema,
  middleware: [apiKeyAuth],
  emits: ['payment.created'],
  flows: ['payment-processing'],
}

export const handler: Handlers['CreatePayment'] = async (req, { logger, emit }) => {
  try {
    const paymentService = new PaymentService()
    const result = await paymentService.createPayment(req.body, req.user)

    await emit({
      topic: 'payment.created',
      data: { paymentId: result.id, transactionId: result.transactionId },
    })

    return {
      status: 201,
      body: { success: true, data: result },
    }
  } catch (error: any) {
    logger.error('Payment creation failed', { error: error.message })
    return {
      status: error.statusCode || 500,
      body: { success: false, error: error.message },
    }
  }
}
```

---

## Total File Count

| Category | Count |
|----------|-------|
| API step files | ~58 |
| Event step files | 7 |
| Cron step files | 4 |
| Middleware files | 2 |
| Config files | 3 (motia.config.ts, api.d.ts, updated package.json) |
| **Total new files** | **~74** |
| Files to delete | ~12 (app.ts, index.ts, 9 route files, controllers dir) |
