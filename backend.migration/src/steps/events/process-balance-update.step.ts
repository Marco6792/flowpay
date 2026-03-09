import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'ProcessBalanceUpdate',
  flows: ['balance-management'],
  type: 'event',
  subscribes: ['balance.refreshed'],
  emits: [],
  description: 'Process balance refresh events for cache invalidation and notifications',
}

export const handler = async (event: any, { logger, streams }: FlowContext) => {
  const { data } = event

  try {
    logger.info('Balance refreshed', {
      userId: data.userId,
      refreshedAt: data.refreshedAt,
      grandTotal: data.grandTotal,
    })

    // Push balance update to real-time stream (3-arg pattern: groupId, key, value)
    await streams.transactionStatus.set(
      `balance-${data.userId}`,
      `balance-refresh-${Date.now()}`,
      {
        id: `balance-${data.userId}`,
        transactionId: `balance-refresh-${Date.now()}`,
        type: 'payment', // balance type not in enum, using payment as closest
        status: 'COMPLETED',
        amount: data.grandTotal,
        currency: 'XAF',
        updatedAt: new Date().toISOString(),
      }
    )
  } catch (error: any) {
    logger.error('Error processing balance update', { error: error.message })
  }
}
