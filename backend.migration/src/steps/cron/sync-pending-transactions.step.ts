import { CronConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'

export const config: CronConfig = {
  name: 'SyncPendingTransactions',
  flows: ['background-jobs'],
  type: 'cron',
  cron: '*/10 * * * *', // Every 10 minutes - safety net only
  description: 'Safety net: sync orphaned pending transactions from DB into State for polling',
  emits: [],
}

export const handler = async ({ logger, state }: FlowContext) => {
  try {
    // Check for orphaned pending payments not in State
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        providerReference: { not: null },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // Last 2 hours only
      },
      select: {
        id: true,
        transactionId: true,
        provider: true,
        providerReference: true,
        status: true,
        amount: true,
        currency: true,
        createdAt: true,
      },
      take: 50,
    })

    let paymentsSynced = 0
    for (const payment of pendingPayments) {
      const existing = await state.get('pending-payments', payment.id)
      if (!existing) {
        await state.set('pending-payments', payment.id, {
          paymentId: payment.id,
          transactionId: payment.transactionId,
          provider: payment.provider,
          providerReference: payment.providerReference,
          status: payment.status,
          amount: Number(payment.amount),
          currency: payment.currency,
          registeredAt: payment.createdAt.getTime(),
          nextCheckAt: Date.now(), // Check immediately
          checkCount: 0,
        })
        paymentsSynced++
      }
    }

    // Check for orphaned pending transfers not in State
    const pendingTransfers = await prisma.transfer.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        providerReference: { not: null },
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        transferId: true,
        provider: true,
        providerReference: true,
        status: true,
        amount: true,
        currency: true,
        createdAt: true,
      },
      take: 50,
    })

    let transfersSynced = 0
    for (const transfer of pendingTransfers) {
      const existing = await state.get('pending-transfers', transfer.id)
      if (!existing) {
        await state.set('pending-transfers', transfer.id, {
          id: transfer.transferId,
          type: 'transfer',
          provider: transfer.provider,
          providerReference: transfer.providerReference,
          status: transfer.status,
          amount: Number(transfer.amount),
          currency: transfer.currency,
          registeredAt: transfer.createdAt.getTime(),
          nextCheckAt: Date.now(),
          checkCount: 0,
        })
        transfersSynced++
      }
    }

    if (paymentsSynced > 0 || transfersSynced > 0) {
      logger.info('Synced orphaned pending transactions to State', { paymentsSynced, transfersSynced })
    }
  } catch (error: any) {
    // DB unreachable is expected sometimes - just log warning, not error
    logger.warn('Sync pending transactions failed (DB may be temporarily unavailable)', { error: error.message })
  }
}
