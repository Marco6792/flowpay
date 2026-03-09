# FlowPay Backend

## Setup Instructions

### Prerequisites
- Bun runtime
- Docker & Docker Compose (for PostgreSQL and Redis)
- PostgreSQL client (optional, for direct database access)

### Installation

1. Install dependencies:
```bash
bun install
```

2. Start PostgreSQL and Redis:
```bash
docker compose up -d
```

3. Setup database:
```bash
bun run db:generate  # Generate Prisma client
bun run db:push      # Push schema to database
bun run db:seed      # Seed with test data
```

4. Start the development server:
```bash
bun run dev
```

The server will start on http://localhost:5000

### API Documentation

Swagger UI is available at: http://localhost:5000/documentation

### Test API Key

After running the seed script, you can use this test API key:
```
X-API-Key: test_key_flowpay_dev_2025
```

### Example API Request

```bash
curl -X POST http://localhost:5000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test_key_flowpay_dev_2025" \
  -d '{
    "from": "237123456789@cameroon",
    "to": "237987654321@cameroon",
    "amount": 5000,
    "timestamp": "2025-08-12T10:30:00Z",
    "id": "txn_test_001"
  }'
```

### Scripts

- `bun run dev` - Start development server with hot reload
- `bun run build` - Build for production
- `bun run start` - Start production server
- `bun run test` - Run tests
- `bun run lint` - Lint code
- `bun run typecheck` - Type check code
- `bun run db:migrate` - Run database migrations
- `bun run db:seed` - Seed database with test data

## Sandbox Environment (Docker)

This repo includes a self-contained sandbox you can run with Docker that brings up PostgreSQL, Redis, and the API server with hot reload and automatic DB setup.

### Quick Start

1) From the `backend` folder, start the sandbox:
```
docker compose -f docker-compose.sandbox.yml up --build -d
```

2) Tail the API logs:
```
docker logs -f flowpay-api
```

3) Verify health and docs:
- Health check: `http://localhost:5000/api/v1/health`
- Swagger UI: `http://localhost:5000/documentation`

The sandbox uses `.env.sandbox` with container-friendly settings (DB host `postgres`, Redis host `redis`). On first boot it runs `prisma generate`, `db push`, and `db seed` automatically.

### Stopping and Cleanup
```
docker compose -f docker-compose.sandbox.yml down
```
To remove volumes (DB/Redis data), add `-v`:
```
docker compose -f docker-compose.sandbox.yml down -v
```

### Notes
- The API listens on port `5000` by default. Update `PORT` in `.env.sandbox` if needed.
- Replace placeholder MTN/Orange credentials in `.env.sandbox` to exercise provider flows against their sandboxes.
- Local webhooks can be received at `http://localhost:5000/api/v1/webhooks/*`. For external callbacks, use a tunnel (e.g., `ngrok`) and set `MTN_CALLBACK_URL` accordingly.


 Use these numbers when testing payments:
  - 56733123453 → Success
  - 46733123454 → Pending
  - 46733123450 → Failed
  - 46733123451 → Rejected
  - 46733123452 → Timeout
