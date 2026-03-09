import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessRefundCreated',
  flows: ['payment-processing', 'refund-management', 'event-processing'],
  type: 'event',
  subscribes: ['refund.created'],
  emits: [],
  description: 'Register newly created refunds in State for event-driven status polling',
}

export const handler = async (event: any, { logger, state, streams }: FlowContext) => {
  const { refundId, transactionId, amount, status, provider, version } = event.data

  if (!refundId) {
    logger.warn('No refund ID in refund created event')
    return
  }

  logger.info('Processing refund created event', { refundId, transactionId, status, provider, version })

  // Push initial status to real-time stream
  await streams.transactionStatus.set('refunds', refundId, {
    id: refundId,
    transactionId: transactionId || refundId,
    type: 'payment',
    status,
    amount,
    provider,
    updatedAt: new Date().toISOString(),
  })

  // Register in State for polling if refund needs status tracking
  if (status === 'PENDING' || status === 'PROCESSING') {
    await state.set('pending-refunds', refundId, {
      id: refundId,
      transactionId,
      provider,
      status,
      amount,
      version,
      registeredAt: Date.now(),
      nextCheckAt: Date.now() + 10_000,
      checkCount: 0,
    })

    logger.info('Refund registered for status polling', { refundId, provider })
  }
}
