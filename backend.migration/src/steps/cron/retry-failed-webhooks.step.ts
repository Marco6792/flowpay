import { CronConfig, FlowContext } from 'motia'
import { prisma, isDatabaseUnavailableError } from '../../utils/database'
import { WebhookService } from '../../services/webhook.service'

export const config: CronConfig = {
  name: 'RetryFailedWebhooks',
  flows: ['webhooks', 'background-jobs'],
  type: 'cron',
  cron: '*/5 * * * *', // Every 5 minutes
  description: 'Retry failed webhook deliveries',
  emits: [],
}

export const handler = async ({ logger }: FlowContext) => {
  logger.info('Starting webhook retry job')

  try {
    // Find failed webhooks that haven't exceeded retry limit
    const failedWebhooks = await prisma.webhookDelivery.findMany({
      where: {
        status: 'FAILED',
        attempts: { lt: 5 }, // Max 5 retry attempts
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    })

    logger.info('Found failed webhooks to retry', { count: failedWebhooks.length })

    for (const webhook of failedWebhooks) {
      try {
        // Process webhook retry
        await WebhookService.processWebhook(webhook.id)

        logger.info('Webhook retry attempted', {
          webhookId: webhook.id,
          attempts: webhook.attempts + 1,
        })
      } catch (error: any) {
        logger.error('Webhook retry failed', {
          webhookId: webhook.id,
          error: error.message,
        })
      }
    }

    logger.info('Webhook retry job completed')
  } catch (error: any) {
    if (isDatabaseUnavailableError(error)) {
      logger.warn('Webhook retry job skipped (DB may be temporarily unavailable)', { error: error.message })
      return
    }

    logger.error('Webhook retry job failed', { error: error.message })
  }
}
