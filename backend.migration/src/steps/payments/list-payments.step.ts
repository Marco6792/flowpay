import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { PaymentStatus } from '@prisma/client'

const querySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'ListPayments',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'List all payments for the authenticated API key',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const apiKeyId = req.apiKey!.id
  const query = req.query as z.infer<typeof querySchema>

  const limit = parseInt(query.limit || '100', 10)
  const offset = parseInt(query.offset || '0', 10)

  const where: any = { apiKeyId }

  if (query.status) where.status = query.status
  if (query.from) where.from = query.from
  if (query.to) where.to = query.to

  if (query.startDate || query.endDate) {
    where.createdAt = {}
    if (query.startDate) where.createdAt.gte = new Date(query.startDate)
    if (query.endDate) where.createdAt.lte = new Date(query.endDate)
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.payment.count({ where }),
  ])

  const formattedPayments = payments.map((payment) => ({
    id: payment.id,
    transactionId: payment.transactionId,
    status: payment.status,
    amount: payment.amount,
    from: payment.from,
    to: payment.to,
    currency: payment.currency,
    provider: payment.provider,
    timestamp: payment.timestamp.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    financialTransactionId: payment.financialTransactionId,
  }))

  return {
    status: 200,
    body: {
      payments: formattedPayments,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    },
  }
}
