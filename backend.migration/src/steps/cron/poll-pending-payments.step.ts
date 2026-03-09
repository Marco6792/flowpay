import { CronConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { ProviderFactory, ProviderType, ProviderMode } from '../../services/providers/provider.factory'

// Exponential backoff: 10s, 20s, 40s, 80s, then cap at 120s
function getNextCheckDelay(checkCount: number): number {
  return Math.min(10_000 * Math.pow(2, checkCount), 120_000)
}

export const config: CronConfig = {
  name: 'PollPendingPayments',
  flows: ['payment-processing', 'background-jobs'],
  type: 'cron',
  cron: '*/30 * * * * *', // Every 30 seconds (reads from State/Redis, not DB)
  description: 'Poll payment status from provider using State-tracked pending payments',
  emits: ['payment.updated'],
}

export const handler = async ({ emit, logger, state, streams }: FlowContext<any>) => {
  try {
    // Read pending payments from State (Redis) - no database hit
    const pendingItems = await state.getGroup<{
      paymentId: string
      transactionId: string
      provider: string
      providerReference: string
      status: string
      amount: number
      currency: string
      mode?: string
      registeredAt: number
      nextCheckAt: number
      checkCount: number
    }>('pending-payments')

    if (!pendingItems || Object.keys(pendingItems).length === 0) return

    const now = Date.now()
    const dueItems = Object.entries(pendingItems).filter(([_, item]) => item.nextCheckAt <= now)

    if (dueItems.length === 0) return

    logger.info('Polling pending payments from State', { total: Object.keys(pendingItems).length, due: dueItems.length })

    for (const [key, item] of dueItems) {
      try {
        // Expire stale items (older than 2 hours)
        if (now - item.registeredAt > 2 * 60 * 60 * 1000) {
          logger.warn('Payment polling expired, removing from state', { paymentId: key })
          await state.delete('pending-payments', key)
          continue
        }

        const providerMode = (item.mode || 'SANDBOX') as ProviderMode
        const provider = ProviderFactory.getProvider(item.provider.toLowerCase() as ProviderType, providerMode)
        if (!provider) {
          logger.warn('Provider not found, removing from state', { paymentId: key, provider: item.provider })
          await state.delete('pending-payments', key)
          continue
        }

        const statusResult = await provider.checkStatus(item.providerReference)
        const resultStatus = String(statusResult.status)
        const newStatus = resultStatus === 'COMPLETED' ? 'COMPLETED' : resultStatus === 'FAILED' ? 'FAILED' : null

        if (newStatus) {
          // Status resolved - update DB and remove from State
          await prisma.payment.update({
            where: { id: key },
            data: {
              status: newStatus as any,
              financialTransactionId: statusResult.financialTransactionId || undefined,
            },
          })

          await emit({
            topic: 'payment.updated',
            data: { paymentId: key, status: newStatus, transactionId: item.transactionId },
          })

          await streams.transactionStatus.set('payments', key, {
            id: key,
            transactionId: item.transactionId,
            type: 'payment',
            status: newStatus,
            previousStatus: item.status,
            amount: item.amount,
            currency: item.currency,
            provider: item.provider,
            updatedAt: new Date().toISOString(),
          })

          // Remove from State - no longer needs polling
          await state.delete('pending-payments', key)

          logger.info('Payment status resolved', { paymentId: key, oldStatus: item.status, newStatus })
        } else {
          // Still pending - update nextCheckAt with exponential backoff
          const nextCount = item.checkCount + 1
          await state.set('pending-payments', key, {
            ...item,
            checkCount: nextCount,
            nextCheckAt: now + getNextCheckDelay(nextCount),
          })
        }
      } catch (error: any) {
        logger.error('Error polling payment', { paymentId: key, error: error.message })
      }
    }
  } catch (error: any) {
    logger.error('Payment polling failed', { error: error.message })
  }
}
