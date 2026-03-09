import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'AuditPreapprovalActivity',
  flows: ['preapproval-management'],
  type: 'event',
  subscribes: [
    'preapproval.created',
    'preapproval.updated',
    'preapproval.cancelled',
  ],
  emits: [],
  description: 'Audit preapproval lifecycle events for tracking and analytics',
}

export const handler = async (event: any, { logger }: FlowContext) => {
  const { topic, data } = event

  try {
    logger.info('Preapproval event tracked', {
      event: topic,
      preapprovalId: data.preapprovalId,
      userId: data.userId,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      timestamp: new Date().toISOString(),
    })

    // Future: Store in audit log, send to analytics, trigger notifications
  } catch (error: any) {
    logger.error('Error auditing preapproval event', { error: error.message, topic })
  }
}
