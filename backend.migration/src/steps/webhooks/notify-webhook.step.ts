import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { WebhookService } from '../../services/webhook.service'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const bodySchema = z.object({
  event: z.enum([
    'payment.completed', 'payment.failed', 'payment.refunded', 'payment.updated',
    'transfer.completed', 'transfer.failed', 'transfer.updated', 'transfer.created',
    'deposit.completed', 'deposit.failed', 'deposit.updated', 'deposit.created',
    'withdrawal.completed', 'withdrawal.failed', 'withdrawal.updated', 'withdrawal.created',
    'preapproval.created', 'preapproval.approved', 'preapproval.rejected', 'preapproval.expired', 'preapproval.cancelled', 'preapproval.failed',
  ]),
  paymentId: z.string().optional(),
  transferId: z.string().optional(),
  depositId: z.string().optional(),
  withdrawalId: z.string().optional(),
  preapprovalId: z.string().optional(),
  timestamp: z.string().datetime(),
  data: z.record(z.string(), z.unknown()).optional(),
})

export const config: ApiRouteConfig = {
  name: 'NotifyWebhook',
  flows: ['webhook-management'],
  type: 'api',
  path: '/api/v1/webhooks/notify',
  method: 'POST',
  emits: ['webhook.notification.queued'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Queue internal webhook notification for merchant',
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  try {
    const webhookData = req.body as z.infer<typeof bodySchema>
    const apiKeyId = req.apiKey!.id

    // Get user settings for webhook URL
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      include: {
        user: {
          include: {
            settings: true,
          },
        },
      },
    })

    if (!apiKey?.user?.settings?.webhookUrl) {
      return {
        status: 400,
        body: {
          error: 'No webhook URL configured',
        },
      }
    }

    // Queue webhook for delivery
    if (apiKey.user.settings?.webhookUrl && webhookData.paymentId) {
      await WebhookService.queueWebhook(
        webhookData.paymentId,
        webhookData.event,
        apiKey.user.settings.webhookUrl!
      )
    }

    logger.info('Webhook notification queued', { webhookData })

    await emit({
      topic: 'webhook.notification.queued',
      data: { event: webhookData.event, apiKeyId },
    })

    return {
      status: 200,
      body: {
        sent: true,
        webhookUrl: apiKey.user.settings.webhookUrl,
      },
    }
  } catch (error: any) {
    logger.error('Error queuing webhook notification', { error })
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
