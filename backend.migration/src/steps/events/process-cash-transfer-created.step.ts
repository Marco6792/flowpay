import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessCashTransferCreated',
  flows: ['remittance', 'money-transfers', 'event-processing'],
  type: 'event',
  subscribes: ['cashtransfer.created'],
  emits: [],
  description: 'Register newly created cash transfers in State for event-driven status polling',
}

export const handler = async (event: any, { logger, state, streams }: FlowContext) => {
  const { transferId, referenceId, status } = event.data

  if (!transferId) {
    logger.warn('No transfer ID in cash transfer created event')
    return
  }

  logger.info('Processing cash transfer created event', { transferId, referenceId, status })

  // Push initial status to real-time stream
  await streams.transactionStatus.set('transfers', transferId, {
    id: transferId,
    transactionId: transferId,
    type: 'transfer',
    status,
    updatedAt: new Date().toISOString(),
  })

  // Register in State for polling if transfer needs status tracking
  if (status === 'PENDING' || status === 'PROCESSING') {
    await state.set('pending-transfers', transferId, {
      id: transferId,
      type: 'cashtransfer',
      referenceId,
      status,
      registeredAt: Date.now(),
      nextCheckAt: Date.now() + 10_000,
      checkCount: 0,
    })

    logger.info('Cash transfer registered for status polling', { transferId })
  }
}
