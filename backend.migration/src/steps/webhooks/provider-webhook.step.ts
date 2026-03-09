import { ApiRouteConfig, FlowContext } from 'motia'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'ProviderWebhook',
  flows: ['webhooks'],
  type: 'api',
  path: '/api/v1/webhooks/provider/:provider',
  method: 'POST',
  emits: ['webhook.mtn.received', 'webhook.orange.received'],
  middleware: [coreMiddleware],
  description: 'Generic provider webhook receiver that routes to specific provider handlers',
}

export const handler = async (req: any, { logger, emit }: FlowContext) => {
  const { provider } = req.params as { provider: string }
  const body = req.body

  logger.info('Received webhook from provider', { provider, body })

  // Route to specific provider handler based on provider name
  const providerLower = provider.toLowerCase()

  if (providerLower === 'mtn') {
    await emit({
      topic: 'webhook.mtn.received',
      data: { body, headers: req.headers },
    })
  } else if (providerLower === 'orange') {
    await emit({
      topic: 'webhook.orange.received',
      data: { body, headers: req.headers },
    })
  }

  return {
    status: 200,
    body: { received: true },
  }
}
