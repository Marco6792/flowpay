import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { WebhookService } from '../../services/webhook.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  id: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'ReplayWebhookDelivery',
  flows: ['webhook-management'],
  type: 'api',
  path: '/api/v1/webhooks/deliveries/:id/replay',
  method: 'POST',
  emits: ['webhook.delivery.replayed'],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Replay a specific webhook delivery',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const apiKeyId = req.apiKey!.id

    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id },
      include: {
        payment: { select: { apiKeyId: true } },
        transfer: { select: { apiKeyId: true } },
        deposit: { select: { apiKeyId: true } },
        withdrawal: { select: { apiKeyId: true } },
        preapproval: { select: { apiKeyId: true } },
      },
    })

    if (!delivery) {
      return {
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'Delivery not found' },
      }
    }

    const ownerApiKeyId =
      delivery.payment?.apiKeyId ||
      delivery.transfer?.apiKeyId ||
      delivery.deposit?.apiKeyId ||
      delivery.withdrawal?.apiKeyId ||
      delivery.preapproval?.apiKeyId

    if (ownerApiKeyId !== apiKeyId) {
      return {
        status: 403,
        body: { statusCode: 403, error: 'Forbidden', message: 'Not allowed' },
      }
    }

    // Reset delivery status and replay
    await prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'PENDING', lastError: null },
    })

    await WebhookService.processWebhook(id)

    const refreshed = await prisma.webhookDelivery.findUnique({ where: { id } })

    await emit({
      topic: 'webhook.delivery.replayed',
      data: { deliveryId: id, newStatus: refreshed?.status },
    })

    logger.info('Webhook delivery replayed', { deliveryId: id, newStatus: refreshed?.status })

    return {
      status: 200,
      body: { ok: true, delivery: refreshed },
    }
  } catch (error: any) {
    logger.error('Error replaying webhook delivery', { error })
    return {
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      },
    }
  }
}
