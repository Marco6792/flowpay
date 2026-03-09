# FlowPay Motia Migration Status

**Last Updated:** 2026-02-11
**Migration Type:** Fastify → Motia
**Strategy:** Parallel deployment with gradual cutover

---

## Overall Progress

- ✅ **Phase 1:** Complete Motia Setup - **COMPLETE**
- ✅ **Phase 2:** Authentication Middleware - **COMPLETE**
- 🟡 **Phase 3:** Core API Endpoints - **IN PROGRESS (16/58 = 28%)**
- ⏳ **Phase 4:** Event-Driven Processing - **PENDING**
- ⏳ **Phase 5:** Scheduled Jobs - **PENDING**
- ⏳ **Phase 6-8:** Testing & Deployment - **PENDING**

---

## Phase 1: Setup ✅

- [x] Motia config with plugins (endpoint, logs, observability, states, bullmq, cron)
- [x] Copied all 15 service files
- [x] Copied provider implementations (MTN, Orange)
- [x] Copied utils (auth, database, logger, validation, errorHandler)
- [x] Copied config files
- [x] Prisma schema and client generated
- [x] Type augmentation (api.d.ts)
- [x] Dependencies installed
- [x] Environment variables configured

---

## Phase 2: Middleware ✅

### Auth Middleware (`src/middleware/auth.middleware.ts`)
- [x] `jwtAuth` - JWT Bearer token authentication
- [x] `apiKeyAuth` - X-API-Key header authentication
- [x] `optionalAuth` - Optional JWT auth for consent endpoints
- [x] `eitherAuth` - Accept either JWT or API key

### Admin Middleware (`src/middleware/admin.middleware.ts`)
- [x] `requireAdmin` - ADMIN or SUPER_ADMIN role required
- [x] `requireSuperAdmin` - SUPER_ADMIN role only
- [x] `requirePermission(permission)` - Permission-based access control

---

## Phase 3: API Endpoints 🟡

### Completed (16/58)

#### Health (1)
- [x] `GET /api/v1/health` - Health check endpoint

#### Auth (5)
- [x] `POST /api/v1/auth/register` - User registration
- [x] `POST /api/v1/auth/login` - User login
- [x] `POST /api/v1/auth/api-keys` - Create API key
- [x] `GET /api/v1/auth/api-keys` - List API keys
- [x] `DELETE /api/v1/auth/api-keys/:id` - Revoke API key

#### Payments (5)
- [x] `POST /api/v1/payments` - Create payment (with event emission)
- [x] `GET /api/v1/payments/:transactionId` - Get payment by ID
- [x] `GET /api/v1/payments` - List payments with pagination
- [x] `GET /api/v1/payments/stats` - Get payment statistics
- [x] `POST /api/v1/payments/:transactionId/cancel` - Cancel payment

#### Webhooks (3) **CRITICAL**
- [x] `POST /api/v1/webhooks/mtn` - MTN webhook receiver (ZERO-DOWNTIME CRITICAL)
- [x] `POST /api/v1/webhooks/orange` - Orange webhook receiver
- [x] `POST /api/v1/webhooks/configure` - Configure webhook URL

#### Balance (1)
- [x] `GET /api/v1/balance/aggregated` - Get aggregated balances

#### Transfers (1)
- [x] `POST /api/v1/transfers` - Create transfer

### Remaining (42)

See `ENDPOINT_MIGRATION_TEMPLATE.md` for complete checklist and templates.

**High Priority:**
- Payment refunds (3 endpoints)
- Withdrawal operations (3 endpoints)
- Webhook status/management (7 endpoints)
- Balance operations (4 remaining)
- Transfer CRUD (3 remaining)

**Medium Priority:**
- Deposits (2 endpoints)
- Consent/OAuth2 (5 endpoints)
- Preapprovals (4 endpoints)

**Lower Priority:**
- Admin endpoints (5+ endpoints)

---

## Phase 4: Event Processing (Not Started)

Events to implement:
- `payment.created` → Start background polling
- `payment.updated` → Forward to merchant webhook
- `webhook.mtn.received` → Process MTN webhook data
- `transfer.created` → Initiate transfer processing

---

## Phase 5: Scheduled Jobs (Not Started)

Cron jobs to implement:
- **Poll Pending Payments** (every 2 minutes)
- **Retry Failed Webhooks** (every 5 minutes)
- **Reconciliation** (daily at 2 AM)
- **Cleanup Expired Sessions** (every 6 hours)

---

## Phase 6-8: Deployment (Not Started)

1. **Parallel Deployment** - Run both Fastify (port 5000) and Motia (port 5001)
2. **Gradual Cutover** - 5% → 50% → 100% traffic to Motia
3. **Monitoring** - Track success rates, response times, errors
4. **Cleanup** - Decommission Fastify after 48 hours of stable 100% traffic

---

## Critical Files

### Configuration
- `backend.migration/motia.config.ts` - Motia configuration
- `backend.migration/package.json` - Dependencies
- `backend.migration/.env` - Environment variables
- `backend.migration/tsconfig.json` - TypeScript config

### Middleware
- `src/middleware/auth.middleware.ts` - Authentication
- `src/middleware/admin.middleware.ts` - Authorization

### Type Definitions
- `src/api.d.ts` - Request type augmentation

### Services (Copied from Fastify)
- `src/services/` - 15 service files (unchanged)
- `src/services/providers/` - MTN and Orange providers
- `src/utils/` - Shared utilities
- `src/config/` - Configuration files

### Migration Guides
- `ENDPOINT_MIGRATION_TEMPLATE.md` - Templates and patterns
- `MIGRATION_STATUS.md` - This file

---

## Quick Start Commands

```bash
# Navigate to Motia project
cd backend.migration

# Install dependencies (if not already done)
npm install

# Generate Prisma client
npx prisma generate

# Start development server (port 5001)
npm run dev

# Generate TypeScript types for Motia
npm run generate-types

# Build for production
npm run build

# Start production server
npm run start
```

---

## Testing

### Local Testing
```bash
# Health check
curl http://localhost:5001/api/v1/health

# Create payment (requires API key)
curl -X POST http://localhost:5001/api/v1/payments \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"from": "237670000000@cameroon", "to": "237680000000@cameroon", "amount": 1000, "timestamp": "2026-02-11T10:00:00Z"}'
```

### Postman Collections
Reuse existing Postman collections from Fastify:
- Point to `http://localhost:5001` instead of `http://localhost:5000`
- All endpoints should work identically

---

## Next Steps

1. **Complete remaining 42 endpoints** using templates in `ENDPOINT_MIGRATION_TEMPLATE.md`
2. **Implement Phase 4:** Event processing steps
3. **Implement Phase 5:** Cron job steps
4. **Test parallel deployment** with both Fastify and Motia running
5. **Begin gradual traffic cutover**

---

## Support

- **Motia Documentation:** Check `.cursor/rules/motia/*.mdc` files
- **Migration Templates:** See `ENDPOINT_MIGRATION_TEMPLATE.md`
- **Original Plan:** Refer to migration plan document

---

## Notes

- All services remain unchanged (copied as-is from Fastify)
- Database schema unchanged - both systems share PostgreSQL
- Redis shared between both systems
- MTN webhook endpoint is CRITICAL for zero-downtime migration
- Event emission added to state-changing operations for future processing
