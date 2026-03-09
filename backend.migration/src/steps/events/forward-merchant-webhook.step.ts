import { EventConfig, FlowContext } from 'motia'
import { WebhookService } from '../../services/webhook.service'
import { prisma } from '../../utils/database'

export const config: EventConfig = {
  name: 'ForwardMerchantWebhook',
  flows: ['payment-processing', 'money-transfers', 'deposits', 'withdrawals', 'webhooks', 'event-processing'],
  type: 'event',
  subscribes: [
    'payment.updated',
    'payment.refunded',
    'payment.cancelled',
    'transfer.updated',
    'deposit.updated',
    'withdrawal.updated',
  ],
  emits: [],
  description: 'Forward transaction status updates to merchant webhooks',
}

export const handler = async (event: any, { logger }: FlowContext) => {
  const transactionId = event.data.paymentId || event.data.transferId || event.data.depositId || event.data.withdrawalId
  const transactionType = event.data.paymentId
    ? 'payment'
    : event.data.transferId
    ? 'transfer'
    : event.data.depositId
    ? 'deposit'
    : 'withdrawal'

  if (!transactionId) {
    logger.warn('No transaction ID in event', { topic: event.topic })
    return
  }

  // Get user settings to find webhook URL
  let userSettings: any = null
  const includeChain = { apiKey: { include: { user: { include: { settings: true } } } } }

  if (transactionType === 'payment') {
    const payment = await prisma.payment.findUnique({
      where: { id: transactionId },
      include: includeChain,
    })
    userSettings = payment?.apiKey?.user?.settings
  } else if (transactionType === 'transfer') {
    const transfer = await prisma.transfer.findUnique({
      where: { id: transactionId },
      include: includeChain,
    })
    userSettings = transfer?.apiKey?.user?.settings
  } else if (transactionType === 'deposit') {
    const deposit = await prisma.deposit.findUnique({
      where: { id: transactionId },
      include: includeChain,
    })
    userSettings = deposit?.apiKey?.user?.settings
  } else if (transactionType === 'withdrawal') {
    const withdrawal = await (prisma as any).withdrawal.findUnique({
      where: { id: transactionId },
      include: includeChain,
    })
    userSettings = withdrawal?.apiKey?.user?.settings
  }

  if (!userSettings?.webhookUrl) {
    logger.debug('No webhook URL configured for transaction', { transactionId, transactionType })
    return
  }

  // Check if user is subscribed to this event type
  const subscribedEvents: string[] = userSettings.webhookEvents || []
  if (subscribedEvents.length > 0 && !subscribedEvents.includes(event.topic)) {
    logger.debug('Merchant not subscribed to event', { transactionId, event: event.topic, subscribedEvents })
    return
  }

  await WebhookService.queueWebhook(transactionId, event.topic as any, userSettings.webhookUrl, userSettings.webhookSecret)
  logger.info('Webhook queued for merchant', { transactionId, transactionType, event: event.topic })
}
