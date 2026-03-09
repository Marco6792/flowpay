import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'AuditConsentActivity',
  flows: ['consent-management'],
  type: 'event',
  subscribes: [
    'consent.created',
    'consent.revoked',
    'consent.subscription.created',
    'consent.bill-payment.created',
    'consent.account-access.created',
  ],
  emits: [],
  description: 'Audit consent lifecycle events for compliance and tracking',
}

export const handler = async (event: any, { logger }: FlowContext) => {
  const { topic, data } = event

  try {
    logger.info('Consent event tracked', {
      event: topic,
      consentId: data.consentId,
      userId: data.userId,
      provider: data.provider,
      scope: data.scope,
      timestamp: new Date().toISOString(),
    })

    // Future: Store in audit log table, send to analytics, notify compliance system
  } catch (error: any) {
    logger.error('Error auditing consent event', { error: error.message, topic })
  }
}
