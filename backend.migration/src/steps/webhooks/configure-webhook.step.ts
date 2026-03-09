import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import crypto from 'crypto'

const bodySchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional(),
  secret: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'ConfigureWebhook',
  flows: ['webhooks'],
  type: 'api',
  path: '/api/v1/webhooks/configure',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Configure webhook URL for receiving transaction notifications',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { url, events, secret } = req.body as z.infer<typeof bodySchema>
    const apiKeyId = req.apiKey!.id

    // Get user from API key
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { userId: true },
    })

    if (!apiKey) {
      return {
        status: 401,
        body: {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid API key',
        },
      }
    }

    // Validate webhook URL format
    try {
      new URL(url)
    } catch (error) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid webhook URL format',
        },
      }
    }

    // Update user settings with webhook configuration
    const settings = await prisma.userSettings.upsert({
      where: { userId: apiKey.userId },
      update: {
        webhookUrl: url,
        webhookSecret: secret || crypto.randomBytes(32).toString('hex'),
        webhookEvents:
          events || [
            'payment.created',
            'payment.completed',
            'payment.failed',
            'payment.updated',
            'transfer.created',
            'transfer.completed',
            'transfer.failed',
            'transfer.updated',
            'deposit.created',
            'deposit.completed',
            'deposit.failed',
            'deposit.updated',
            'withdrawal.created',
            'withdrawal.completed',
            'withdrawal.failed',
            'withdrawal.updated',
          ],
      },
      create: {
        userId: apiKey.userId,
        webhookUrl: url,
        webhookSecret: secret || crypto.randomBytes(32).toString('hex'),
        webhookEvents:
          events || [
            'payment.created',
            'payment.completed',
            'payment.failed',
            'payment.updated',
            'payment.refunded',
            'payment.cancelled',
            'transfer.created',
            'transfer.completed',
            'transfer.failed',
            'transfer.updated',
            'deposit.created',
            'deposit.completed',
            'deposit.failed',
            'deposit.updated',
            'withdrawal.created',
            'withdrawal.completed',
            'withdrawal.failed',
            'withdrawal.updated',
          ],
        notificationEmail: '',
        enableEmail: true,
      },
    })

    logger.info(
      'Webhook configuration updated',
      {
        userId: apiKey.userId,
        webhookUrl: url,
        events: settings.webhookEvents,
      }
    )

    return {
      status: 200,
      body: {
        message: 'Webhook configured successfully',
        url: settings.webhookUrl,
        events: settings.webhookEvents,
        secret: settings.webhookSecret,
      },
    }
  } catch (error: any) {
    logger.error('Error configuring webhook', { error: error.message })
    return {
      status: 500,
      body: {
        error: 'Internal Server Error',
        message: 'Failed to configure webhook',
      },
    }
  }
}
