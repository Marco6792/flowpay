import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'GetPaymentStats',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/stats',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get payment statistics for the authenticated API key',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const apiKeyId = req.apiKey!.id
  const query = req.query as z.infer<typeof querySchema>

  const where: any = { apiKeyId }

  if (query.startDate || query.endDate) {
    where.createdAt = {}
    if (query.startDate) where.createdAt.gte = new Date(query.startDate)
    if (query.endDate) where.createdAt.lte = new Date(query.endDate)
  }

  const [total, completed, failed, pending, processing, amounts] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.payment.count({ where: { ...where, status: 'FAILED' } }),
    prisma.payment.count({ where: { ...where, status: 'PENDING' } }),
    prisma.payment.count({ where: { ...where, status: 'PROCESSING' } }),
    prisma.payment.aggregate({
      where: { ...where, status: 'COMPLETED' },
      _sum: { amount: true },
      _avg: { amount: true },
      _min: { amount: true },
      _max: { amount: true },
    }),
  ])

  return {
    status: 200,
    body: {
      total,
      byStatus: {
        completed,
        failed,
        pending,
        processing,
      },
      amounts: {
        total: amounts._sum.amount || 0,
        average: amounts._avg.amount || 0,
        min: amounts._min.amount || 0,
        max: amounts._max.amount || 0,
      },
      successRate: total > 0 ? (completed / total) * 100 : 0,
    },
  }
}
