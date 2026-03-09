# FlowPay Endpoint Migration Template

This template provides patterns for quickly migrating the remaining Fastify endpoints to Motia steps.

## Progress Tracker

### ✅ Completed (16 endpoints)
- [x] Health check
- [x] Auth: register, login, create/list/revoke API keys (5)
- [x] Payments: create, get, list, stats, cancel (5)
- [x] Webhooks: MTN, Orange, configure (3)
- [x] Balance: aggregated (1)
- [x] Transfers: create (1)

### 📋 Remaining (~42 endpoints)

#### Payments (4)
- [ ] POST /api/v1/payments/:id/notify
- [ ] POST /api/v1/payments/:id/refund
- [ ] GET /api/v1/refunds/:refundId/status
- [ ] GET /api/v1/payments/:id/refunds

#### Withdrawals (3)
- [ ] POST /api/v1/withdraw
- [ ] GET /api/v1/withdraw/:withdrawId
- [ ] GET /api/v1/withdrawals (list)

#### Transfers (3)
- [ ] GET /api/v1/transfers/:transferId
- [ ] GET /api/v1/transfers/:transferId/status
- [ ] GET /api/v1/transfers (list)

#### Deposits (2)
- [ ] POST /api/v1/deposits
- [ ] GET /api/v1/deposits/:depositId/status

#### Balance (4)
- [ ] GET /api/v1/balance/wallets
- [ ] GET /api/v1/balance/providers
- [ ] GET /api/v1/balance/provider/:provider
- [ ] POST /api/v1/balance/refresh
- [ ] GET /api/v1/balance/transactions

#### Consent/OAuth2 (5)
- [ ] POST /api/v1/consent/request
- [ ] GET /api/v1/consent/status/:consentId
- [ ] POST /api/v1/consent/authorize
- [ ] POST /api/v1/consent/revoke
- [ ] GET /api/v1/consent/list

#### Preapprovals (4)
- [ ] POST /api/v1/preapprovals
- [ ] GET /api/v1/preapprovals/:id
- [ ] POST /api/v1/preapprovals/:id/cancel
- [ ] GET /api/v1/preapprovals (list)

#### Webhooks (7)
- [ ] GET /api/v1/webhooks/status
- [ ] POST /api/v1/webhooks/test
- [ ] GET /api/v1/webhooks/stream (SSE)
- [ ] GET /api/v1/webhooks/deliveries
- [ ] GET /api/v1/webhooks/deliveries/:id
- [ ] POST /api/v1/webhooks/deliveries/:id/replay
- [ ] POST /api/v1/webhooks/notify

#### Admin (5+)
- [ ] POST /api/v1/admin/auth/login
- [ ] POST /api/v1/admin/fees
- [ ] GET /api/v1/admin/fees
- [ ] PUT /api/v1/admin/fees/:id
- [ ] DELETE /api/v1/admin/fees/:id
- [ ] POST /api/v1/admin/fees/:id/assign

---

## Step File Templates

### Template 1: Simple GET with Path Parameter

**Example:** `GET /api/v1/payments/:transactionId`

```typescript
import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database.ts'
import { apiKeyAuth } from '../../middleware/auth.middleware.ts'

const paramsSchema = z.object({
  transactionId: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetPayment',
  type: 'api',
  path: '/api/v1/payments/:transactionId',
  method: 'GET',
  paramsSchema,
  middleware: [apiKeyAuth],
  description: 'Get payment by transaction ID',
}

export const handler: Handlers['GetPayment'] = async (req) => {
  const { transactionId } = req.params as z.infer<typeof paramsSchema>
  const apiKeyId = req.apiKey!.id

  const payment = await prisma.payment.findFirst({
    where: { transactionId, apiKeyId },
  })

  if (!payment) {
    return {
      status: 404,
      body: { error: 'Payment not found' },
    }
  }

  return {
    status: 200,
    body: { /* payment data */ },
  }
}
```

### Template 2: POST with Body and Events

**Example:** `POST /api/v1/payments/:id/refund`

```typescript
import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { PaymentService } from '../../services/payment.service.ts'
import { apiKeyAuth } from '../../middleware/auth.middleware.ts'
import { logger } from '../../utils/logger.ts'

const paramsSchema = z.object({
  id: z.string(),
})

const bodySchema = z.object({
  amount: z.number().optional(),
  reason: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'RefundPayment',
  type: 'api',
  path: '/api/v1/payments/:id/refund',
  method: 'POST',
  paramsSchema,
  bodySchema,
  middleware: [apiKeyAuth],
  description: 'Refund a completed payment',
  emits: ['payment.refunded'],
}

export const handler: Handlers['RefundPayment'] = async (req, { emit }) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const body = req.body as z.infer<typeof bodySchema>

    const paymentService = new PaymentService()
    const refund = await paymentService.refundPayment(id, body.amount, body.reason)

    await emit({
      topic: 'payment.refunded',
      data: { paymentId: id, refundId: refund.id },
    })

    logger.info({ paymentId: id, refundId: refund.id }, 'Payment refunded')

    return {
      status: 201,
      body: { /* refund data */ },
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error refunding payment')
    return {
      status: 500,
      body: { error: 'Failed to refund payment' },
    }
  }
}
```

### Template 3: GET with Query Parameters

**Example:** `GET /api/v1/transfers?limit=10&status=COMPLETED`

```typescript
import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database.ts'
import { apiKeyAuth } from '../../middleware/auth.middleware.ts'

const querySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'ListTransfers',
  type: 'api',
  path: '/api/v1/transfers',
  method: 'GET',
  querySchema,
  middleware: [apiKeyAuth],
  description: 'List all transfers with pagination',
}

export const handler: Handlers['ListTransfers'] = async (req) => {
  const query = req.query as z.infer<typeof querySchema>
  const apiKeyId = req.apiKey!.id

  const page = parseInt(query.page || '1', 10)
  const limit = parseInt(query.limit || '50', 10)
  const offset = (page - 1) * limit

  const where: any = { apiKeyId }
  if (query.status) where.status = query.status

  const [transfers, total] = await Promise.all([
    prisma.transfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.transfer.count({ where }),
  ])

  return {
    status: 200,
    body: {
      transfers: transfers.map(t => ({ /* mapped data */ })),
      pagination: { page, limit, total, hasMore: offset + limit < total },
    },
  }
}
```

### Template 4: Admin Endpoint with Role Check

**Example:** `POST /api/v1/admin/fees`

```typescript
import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { FeeService } from '../../services/fee.service.ts'
import { requireAdmin } from '../../middleware/admin.middleware.ts'
import { logger } from '../../utils/logger.ts'

const bodySchema = z.object({
  name: z.string(),
  type: z.enum(['FIXED', 'PERCENTAGE']),
  value: z.number(),
  currency: z.string().default('XAF'),
})

export const config: ApiRouteConfig = {
  name: 'CreateFee',
  type: 'api',
  path: '/api/v1/admin/fees',
  method: 'POST',
  bodySchema,
  middleware: [requireAdmin],
  description: 'Create a new fee structure (admin only)',
}

export const handler: Handlers['CreateFee'] = async (req) => {
  try {
    const body = req.body as z.infer<typeof bodySchema>

    const fee = await FeeService.createFee(body)

    logger.info({ feeId: fee.id, createdBy: req.user!.userId }, 'Fee structure created')

    return {
      status: 201,
      body: { success: true, data: fee },
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error creating fee')
    return {
      status: 500,
      body: { success: false, error: 'Failed to create fee' },
    }
  }
}
```

### Template 5: Service Method Call Pattern

**Example:** Using existing service methods

```typescript
import { ApiRouteConfig, Handlers } from 'motia'
import { BalanceService } from '../../services/balance.service.ts'
import { apiKeyAuth } from '../../middleware/auth.middleware.ts'

export const config: ApiRouteConfig = {
  name: 'GetWalletBalances',
  type: 'api',
  path: '/api/v1/balance/wallets',
  method: 'GET',
  middleware: [apiKeyAuth],
  description: 'Get local wallet balances only',
}

export const handler: Handlers['GetWalletBalances'] = async (req) => {
  const balanceService = new BalanceService()
  const wallets = await balanceService.getWalletBalances(req.apiKey!.userId)

  return {
    status: 200,
    body: {
      success: true,
      data: wallets,
    },
  }
}
```

---

## Quick Migration Steps

For each remaining endpoint:

1. **Find the Fastify route** in `backend/src/routes/*.ts`
2. **Find the controller method** in `backend/src/controllers/*.ts`
3. **Create new step file** in `backend.migration/src/steps/<domain>/<name>.step.ts`
4. **Use appropriate template** from above
5. **Copy business logic** from controller (usually a service call)
6. **Add event emission** if the operation modifies state
7. **Test locally** with Motia dev server

## File Naming Convention

```
src/steps/
  ├── auth/
  │   ├── register.step.ts
  │   └── login.step.ts
  ├── payments/
  │   ├── create-payment.step.ts
  │   ├── get-payment.step.ts
  │   └── list-payments.step.ts
  ├── webhooks/
  │   ├── mtn-webhook.step.ts
  │   └── configure-webhook.step.ts
  └── admin/
      ├── login.step.ts
      └── create-fee.step.ts
```

## Common Patterns

### 1. Authentication Middleware
```typescript
middleware: [apiKeyAuth]  // For merchant endpoints
middleware: [jwtAuth]     // For user management endpoints
middleware: [requireAdmin] // For admin endpoints
middleware: [requireSuperAdmin] // For super admin only
```

### 2. Event Emission
```typescript
emits: ['payment.created', 'payment.updated']

// In handler:
await emit({
  topic: 'payment.created',
  data: { paymentId: payment.id },
})
```

### 3. Error Handling
```typescript
try {
  // Business logic
  return { status: 200, body: { success: true, data } }
} catch (error: any) {
  logger.error({ error: error.message }, 'Operation failed')
  return { status: 500, body: { error: 'Failed to complete operation' } }
}
```

### 4. Zod Schema Validation
```typescript
const bodySchema = z.object({
  email: z.string().email(),
  amount: z.number().min(100),
  status: z.enum(['PENDING', 'COMPLETED']),
})
```

---

## Testing Each Endpoint

After creating a step:

1. **Start Motia dev server:**
   ```bash
   cd backend.migration && npm run dev
   ```

2. **Test with curl:**
   ```bash
   curl -X POST http://localhost:5001/api/v1/payments \
     -H "X-API-Key: your_key" \
     -H "Content-Type: application/json" \
     -d '{"from": "237670000000@cameroon", "to": "237680000000@cameroon", "amount": 1000, "timestamp": "2026-02-11T10:00:00Z"}'
   ```

3. **Check Motia logs** for errors

4. **Verify in database** (if applicable)

---

## Next Steps After All Endpoints

Once all step files are created:

1. **Phase 4:** Create event processing steps
2. **Phase 5:** Create cron job steps
3. **Phase 6:** Parallel testing with Fastify
4. **Phase 7:** Gradual traffic cutover
5. **Phase 8:** Decommission Fastify

Good luck! 🚀
