import { CronConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { ProviderFactory, ProviderType, ProviderMode } from '../../services/providers/provider.factory'

// Exponential backoff: 10s, 20s, 40s, 80s, then cap at 120s
function getNextCheckDelay(checkCount: number): number {
  return Math.min(10_000 * Math.pow(2, checkCount), 120_000)
}

export const config: CronConfig = {
  name: 'PollPendingTransfers',
  flows: ['money-transfers', 'background-jobs'],
  type: 'cron',
  cron: '*/30 * * * * *', // Every 30 seconds (reads from State/Redis, not DB)
  description: 'Poll transfer status from provider using State-tracked pending transfers',
  emits: ['transfer.updated'],
}

export const handler = async ({ emit, logger, state, streams }: FlowContext<any>) => {
  try {
    // Read pending transfers from State (Redis) - no database hit
    const pendingItems = await state.getGroup<{
      id: string
      type: string
      provider: string
      providerReference: string
      status: string
      amount: number
      currency: string
      mode?: string
      registeredAt: number
      nextCheckAt: number
      checkCount: number
    }>('pending-transfers')

    if (!pendingItems || Object.keys(pendingItems).length === 0) return

    const now = Date.now()
    const dueItems = Object.entries(pendingItems).filter(([_, item]) => item.nextCheckAt <= now)

    if (dueItems.length === 0) return

    logger.info('Polling pending transfers from State', { total: Object.keys(pendingItems).length, due: dueItems.length })

    for (const [key, item] of dueItems) {
      try {
        // Expire stale items (older than 2 hours)
        if (now - item.registeredAt > 2 * 60 * 60 * 1000) {
          logger.warn('Transfer polling expired, removing from state', { transferId: key })
          await state.delete('pending-transfers', key)
          continue
        }

        const providerMode = (item.mode || 'SANDBOX') as ProviderMode
        const provider = ProviderFactory.getProvider(item.provider.toLowerCase() as ProviderType, providerMode)
        if (!provider) {
          logger.warn('Provider not found, removing from state', { transferId: key, provider: item.provider })
          await state.delete('pending-transfers', key)
          continue
        }

        const statusResult = await provider.checkTransferStatus(item.providerReference)
        const resultStatus = String(statusResult.status)
        const newStatus = resultStatus === 'COMPLETED' ? 'COMPLETED' : resultStatus === 'FAILED' ? 'FAILED' : null

        if (newStatus) {
          // Status resolved - update DB and remove from State
          await prisma.transfer.update({
            where: { id: key },
            data: {
              status: newStatus as any,
              financialTransactionId: (statusResult as any).financialTransactionId || undefined,
              completedAt: newStatus === 'COMPLETED' ? new Date() : null,
            },
          })

          await emit({
            topic: 'transfer.updated',
            data: { transferId: key, status: newStatus },
          })

          await streams.transactionStatus.set('transfers', key, {
            id: key,
            transactionId: item.id,
            type: 'transfer',
            status: newStatus,
            previousStatus: item.status,
            amount: item.amount,
            currency: item.currency,
            provider: item.provider,
            updatedAt: new Date().toISOString(),
          })

          // Remove from State
          await state.delete('pending-transfers', key)

          logger.info('Transfer status resolved', { transferId: key, oldStatus: item.status, newStatus })
        } else {
          // Still pending - exponential backoff
          const nextCount = item.checkCount + 1
          await state.set('pending-transfers', key, {
            ...item,
            checkCount: nextCount,
            nextCheckAt: now + getNextCheckDelay(nextCount),
          })
        }
      } catch (error: any) {
        logger.error('Error polling transfer', { transferId: key, error: error.message })
      }
    }
  } catch (error: any) {
    logger.error('Transfer polling failed', { error: error.message })
  }
}
