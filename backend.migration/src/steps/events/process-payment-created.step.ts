import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessPaymentCreated',
  flows: ['payment-processing', 'event-processing'],
  type: 'event',
  subscribes: ['payment.created'],
  emits: [],
  description: 'Register newly created payments in State for event-driven status polling',
}

export const handler = async (event: any, { logger, state, streams }: FlowContext) => {
  const { paymentId, transactionId, status, provider, providerReference, amount, currency, mode } = event.data

  logger.info('Processing payment created event', { paymentId, transactionId, status, mode })

  // Push initial status to real-time stream
  await streams.transactionStatus.set('payments', paymentId, {
    id: paymentId,
    transactionId,
    type: 'payment',
    status,
    amount,
    currency,
    mode: mode || 'SANDBOX',
    updatedAt: new Date().toISOString(),
  })

  // Register in State for polling if payment needs status tracking
  if ((status === 'PENDING' || status === 'PROCESSING') && providerReference) {
    await state.set('pending-payments', paymentId, {
      paymentId,
      transactionId,
      provider,
      providerReference,
      status,
      amount,
      currency,
      mode: mode || 'SANDBOX',
      registeredAt: Date.now(),
      nextCheckAt: Date.now() + 10_000, // First check after 10 seconds
      checkCount: 0,
    })

    logger.info('Payment registered for status polling', { paymentId, provider, mode })
  }
}
