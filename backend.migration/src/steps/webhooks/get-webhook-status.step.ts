import { ApiRouteConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'GetWebhookStatus',
  flows: ['webhooks'],
  type: 'api',
  path: '/api/v1/webhooks/status',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get webhook configuration status',
}

export const handler = async (req: any, _ctx: FlowContext) => {
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: req.apiKey!.id },
      include: {
        user: {
          include: {
            settings: {
              select: {
                webhookUrl: true,
                webhookEvents: true,
              },
            },
          },
        },
      },
    })

    if (!apiKey?.user?.settings?.webhookUrl) {
      return {
        status: 200,
        body: {
          configured: false,
          message: 'No webhook configured',
        },
      }
    }

    return {
      status: 200,
      body: {
        configured: true,
        url: apiKey.user.settings.webhookUrl,
        events: apiKey.user.settings.webhookEvents,
      },
    }
  } catch (error: any) {
    return {
      status: 500,
      body: {
        error: 'Failed to get webhook status',
      },
    }
  }
}
