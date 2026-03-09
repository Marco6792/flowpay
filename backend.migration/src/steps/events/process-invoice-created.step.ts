import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessInvoiceCreated',
  flows: ['payment-processing', 'invoices', 'event-processing'],
  type: 'event',
  subscribes: ['invoice.created'],
  emits: [],
  description: 'Register newly created invoices in State for event-driven status polling',
}

export const handler = async (event: any, { logger, state, streams }: FlowContext) => {
  const { invoiceId, referenceId, externalId, status } = event.data

  if (!invoiceId && !referenceId) {
    logger.warn('No invoice or reference ID in invoice created event')
    return
  }

  const id = invoiceId || referenceId

  logger.info('Processing invoice created event', { invoiceId, referenceId, externalId, status })

  // Push initial status to real-time stream
  await streams.transactionStatus.set('invoices', id, {
    id,
    transactionId: id,
    type: 'payment',
    status,
    updatedAt: new Date().toISOString(),
  })

  // Register in State for polling if invoice needs status tracking
  if (status === 'PENDING' || status === 'PROCESSING') {
    await state.set('pending-invoices', id, {
      id,
      invoiceId,
      referenceId,
      externalId,
      status,
      registeredAt: Date.now(),
      nextCheckAt: Date.now() + 10_000,
      checkCount: 0,
    })

    logger.info('Invoice registered for status polling', { id })
  }
}
