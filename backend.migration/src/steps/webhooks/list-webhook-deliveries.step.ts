import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

const querySchema = z.object({
  limit: z.string().default('50'),
  offset: z.string().default('0'),
})

export const config: ApiRouteConfig = {
  name: 'ListWebhookDeliveries',
  flows: ['webhooks'],
  type: 'api',
  path: '/api/v1/webhooks/deliveries',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'List recent webhook deliveries for current API key',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  const { limit, offset } = req.query as z.infer<typeof querySchema>
  const apiKeyId = req.apiKey!.id

  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      OR: [
        { payment: { is: { apiKeyId } } },
        { transfer: { is: { apiKeyId } } },
        { deposit: { is: { apiKeyId } } },
        { withdrawal: { is: { apiKeyId } } },
        { preapproval: { is: { apiKeyId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit, 10),
    skip: parseInt(offset, 10),
  })

  return {
    status: 200,
    body: {
      items: deliveries.map((d) => {
        return {
          id: d.id,
          url: d.url,
          status: d.status,
          attempts: d.attempts,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          deliveredAt: d.deliveredAt,
          lastError: d.lastError,
          event: (d as any).payload?.event || null,
          transactionId: (d as any).payload?.transactionId || null,
          payloadStatus: (d as any).payload?.status || null,
          entity: d.paymentId
            ? 'payment'
            : d.transferId
            ? 'transfer'
            : d.depositId
            ? 'deposit'
            : d.withdrawalId
            ? 'withdrawal'
            : d.preapprovalId
            ? 'preapproval'
            : 'unknown',
        }
      }),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    },
  }
}
