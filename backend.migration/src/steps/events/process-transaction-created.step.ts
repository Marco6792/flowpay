import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessTransactionCreated',
  flows: ['money-transfers', 'deposits', 'withdrawals', 'event-processing'],
  type: 'event',
  subscribes: ['transfer.created', 'deposit.created', 'withdrawal.created'],
  emits: [],
  description: 'Register newly created transactions in State for event-driven status polling',
}

export const handler = async (event: any, { logger, state, streams }: FlowContext) => {
  const { topic, data } = event
  const transactionId = data.transferId || data.depositId || data.withdrawalId

  if (!transactionId) {
    logger.warn('No transaction ID in created event', { topic })
    return
  }

  const type = data.transferId ? 'transfer' : data.depositId ? 'deposit' : 'withdrawal'

  logger.info('Processing transaction created event', { type, transactionId, status: data.status })

  // Push initial status to real-time stream
  await streams.transactionStatus.set(`${type}s`, transactionId, {
    id: transactionId,
    transactionId,
    type,
    status: data.status,
    updatedAt: new Date().toISOString(),
  })

  // Register in State for polling if transaction needs status tracking
  if ((data.status === 'PENDING' || data.status === 'PROCESSING') && data.providerReference) {
    const stateGroup = type === 'transfer' ? 'pending-transfers' : `pending-${type}s`

    await state.set(stateGroup, transactionId, {
      id: transactionId,
      type,
      provider: data.provider,
      providerReference: data.providerReference,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      registeredAt: Date.now(),
      nextCheckAt: Date.now() + 10_000, // First check after 10 seconds
      checkCount: 0,
    })

    logger.info('Transaction registered for status polling', { type, transactionId, provider: data.provider })
  }
}
