import { ApiRouteConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { WebhookService } from '../../services/webhook.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

export const config: ApiRouteConfig = {
  name: 'RetryFailedWebhooksApi',
  flows: ['webhook-management'],
  type: 'api',
  path: '/api/v1/webhooks/retry-failed',
  method: 'POST',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Retry all recently failed webhooks for the current API key',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const apiKeyId = req.apiKey!.id

    // Get failed webhooks for this API key's transactions
    const failedDeliveries = await prisma.webhookDelivery.findMany({
      where: {
        status: 'FAILED',
        OR: [
          { payment: { is: { apiKeyId } } },
          { transfer: { is: { apiKeyId } } },
          { deposit: { is: { apiKeyId } } },
          { withdrawal: { is: { apiKeyId } } },
          { preapproval: { is: { apiKeyId } } },
        ],
        attempts: { lt: 5 },
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    })

    // Queue them for retry
    for (const delivery of failedDeliveries) {
      await WebhookService.processWebhook(delivery.id)
    }

    logger.info('Retrying failed webhooks', { count: failedDeliveries.length, apiKeyId })

    return {
      status: 200,
      body: {
        message: `Queued ${failedDeliveries.length} webhooks for retry`,
        count: failedDeliveries.length,
      },
    }
  } catch (error: any) {
    logger.error('Error retrying failed webhooks', { error })
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
