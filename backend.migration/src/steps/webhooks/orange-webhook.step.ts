import { ApiRouteConfig, FlowContext } from 'motia'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'OrangeWebhook',
  flows: ['webhooks'],
  type: 'api',
  path: '/api/v1/webhooks/orange',
  method: 'POST',
  middleware: [coreMiddleware],
  description: 'Receive webhooks from Orange Money provider',
  emits: ['webhook.orange.received'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  const payload = req.body

  logger.info('Received Orange webhook', { payload, provider: 'orange' })

  // Emit event for background processing
  await emit({
    topic: 'webhook.orange.received',
    data: { payload },
  })

  // TODO: Implement Orange webhook handling similar to MTN

  return {
    status: 200,
    body: { received: true },
  }
}
