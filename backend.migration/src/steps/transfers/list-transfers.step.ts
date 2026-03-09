import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const querySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'ListTransfers',
  flows: ['money-transfers'],
  type: 'api',
  path: '/api/v1/transfers',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'List all transfers with pagination',
}

export const handler = async (req: any, _ctx: FlowContext) => {
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
      success: true,
      data: {
        transfers: transfers.map((t) => ({
          transferId: t.transferId,
          status: t.status,
          amount: t.amount,
          currency: t.currency,
          from: t.from,
          to: t.to,
          description: t.description,
          fee: t.fee,
          providerReference: t.providerReference,
          createdAt: t.createdAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          hasMore: offset + limit < total,
        },
      },
    },
  }
}
