import { EventConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'

export const config: EventConfig = {
  name: 'ProcessWebhookReceived',
  flows: ['webhooks', 'event-processing'],
  type: 'event',
  subscribes: ['webhook.mtn.received', 'webhook.orange.received'],
  emits: [],
  description: 'Process incoming provider webhook notifications for audit and stream updates',
}

export const handler = async (event: any, { logger, streams }: FlowContext) => {
  const { topic, data } = event

  logger.info('Processing webhook received event', { topic, data })

  // For MTN webhooks, update the transaction status stream
  if (data.transactionId && data.transactionType && data.status) {
    const type = data.transactionType as 'payment' | 'transfer' | 'deposit' | 'withdrawal'
    const groupId = `${type}s`

    await streams.transactionStatus.set(groupId, data.transactionId, {
      id: data.transactionId,
      transactionId: data.referenceId || data.transactionId,
      type,
      status: data.status,
      provider: topic === 'webhook.mtn.received' ? 'mtn' : 'orange',
      updatedAt: new Date().toISOString(),
    })

    logger.info('Transaction status stream updated from webhook', {
      type,
      transactionId: data.transactionId,
      status: data.status,
    })
  }

  // For Orange webhooks, log payload for now (implementation pending)
  if (topic === 'webhook.orange.received' && data.payload) {
    logger.info('Orange webhook payload received for processing', { payload: data.payload })
  }
}
