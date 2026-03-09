import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'AuditWebhookActivity',
  flows: ['webhook-management'],
  type: 'event',
  subscribes: [
    'webhook.delivery.replayed',
    'webhook.notification.queued',
  ],
  emits: [],
  description: 'Audit webhook delivery events for monitoring and debugging',
}

export const handler = async (event: any, { logger }: FlowContext) => {
  const { topic, data } = event

  try {
    logger.info('Webhook event tracked', {
      event: topic,
      deliveryId: data.deliveryId,
      newStatus: data.newStatus,
      apiKeyId: data.apiKeyId,
      webhookEvent: data.event,
      timestamp: new Date().toISOString(),
    })

    // Future: Store in webhook audit log, track replay patterns, alert on excessive failures
  } catch (error: any) {
    logger.error('Error auditing webhook event', { error: error.message, topic })
  }
}
