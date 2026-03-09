import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessInvoiceCancelled',
  flows: ['payment-processing', 'invoices', 'event-processing'],
  type: 'event',
  subscribes: ['invoice.cancelled'],
  emits: [],
  description: 'Handle invoice cancellation events and update state accordingly',
}

export const handler = async (event: any, { logger, state, streams }: FlowContext) => {
  const { referenceId, provider } = event.data

  if (!referenceId) {
    logger.warn('No reference ID in invoice cancelled event')
    return
  }

  logger.info('Processing invoice cancelled event', { referenceId, provider })

  // Update the stream with cancelled status
  await streams.transactionStatus.set('invoices', referenceId, {
    id: referenceId,
    transactionId: referenceId,
    type: 'payment',
    status: 'CANCELLED',
    previousStatus: 'PENDING',
    provider,
    updatedAt: new Date().toISOString(),
  })

  // Remove from pending invoices if it was being polled
  try {
    await state.delete('pending-invoices', referenceId)
    logger.info('Removed cancelled invoice from pending state', { referenceId })
  } catch {
    // Invoice may not have been in pending state
    logger.debug('Invoice was not in pending state', { referenceId })
  }
}
