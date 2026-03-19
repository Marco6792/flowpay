import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { env } from '../../config/env'
import { MTNMobileMoneyProvider } from '../../services/providers/mtn.provider'
import { coreMiddleware } from '../../middlewares/core.middleware'

const mtnWebhookSchema = z.object({
  financialTransactionId: z.string().optional(),
  externalId: z.string(),
  amount: z.string(),
  currency: z.string(),
  payer: z
    .object({
      partyIdType: z.string(),
      partyId: z.string(),
    })
    .optional(),
  payee: z
    .object({
      partyIdType: z.string(),
      partyId: z.string(),
    })
    .optional(),
  status: z.enum(['SUCCESSFUL', 'FAILED', 'PENDING', 'REJECTED', 'APPROVAL_REJECTED', 'CANCELLED']),
  reason: z.string().optional(),
})

export const config: ApiRouteConfig = {
  name: 'MtnWebhook',
  flows: ['webhooks', 'payment-processing', 'money-transfers', 'deposits', 'withdrawals'],
  type: 'api',
  path: '/api/v1/webhooks/mtn',
  method: 'POST',
  // No auth - public endpoint with optional signature verification
  middleware: [coreMiddleware],
  description: 'Receive webhooks from MTN Mobile Money provider',
  emits: ['webhook.mtn.received', 'payment.updated', 'transfer.updated', 'deposit.updated', 'withdrawal.updated'],
}

export const handler = async (req: any, { emit, logger }: FlowContext<any>) => {
  const payload = req.body
  const signature = req.headers['x-mtn-signature'] as string
  const referenceId = req.headers['x-reference-id'] as string

  logger.info(
    'Received MTN webhook',
    {
      payload,
      referenceId,
      hasSignature: !!signature,
      provider: 'mtn',
    }
  )

  try {
    // 1. Verify signature (production only)
    if (env.NODE_ENV === 'production' && signature) {
      const mtnProvider = new MTNMobileMoneyProvider()
      const isValid = mtnProvider.verifyWebhook(payload, signature)

      if (!isValid) {
        logger.warn('Invalid MTN webhook signature', { referenceId })
        return {
          status: 401,
          body: { error: 'Invalid signature' },
        }
      }
    }

    // 2. Parse and validate MTN payload
    const webhookData = mtnWebhookSchema.safeParse(payload)
    if (!webhookData.success) {
      logger.error(
        'Invalid MTN webhook payload',
        {
          error: webhookData.error,
          payload,
        }
      )
      return {
        status: 400,
        body: { error: 'Invalid payload' },
      }
    }

    // 3. Find transaction by external ID or provider reference
    let payment = await prisma.payment.findFirst({
      where: {
        OR: [{ transactionId: webhookData.data.externalId }, { providerReference: referenceId }],
      },
      include: {
        apiKey: {
          include: {
            user: {
              include: {
                settings: true,
              },
            },
          },
        },
      },
    })

    let transfer = null
    let deposit = null
    let withdrawal = null
    let preapproval = null

    if (!payment) {
      transfer = await prisma.transfer.findFirst({
        where: {
          OR: [{ transferId: webhookData.data.externalId }, { providerReference: referenceId }],
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
    }

    if (!payment && !transfer) {
      deposit = await prisma.deposit.findFirst({
        where: {
          OR: [{ depositId: webhookData.data.externalId }, { providerReference: referenceId }],
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
    }

    if (!payment && !transfer && !deposit) {
      withdrawal = await (prisma as any).withdrawal.findFirst({
        where: {
          OR: [{ withdrawId: webhookData.data.externalId }, { providerReference: referenceId }],
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
    }

    if (!payment && !transfer && !deposit && !withdrawal) {
      preapproval = await prisma.preApproval.findFirst({
        where: {
          OR: [{ preApprovalId: webhookData.data.externalId }, { referenceId: referenceId }],
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
    }

    if (!payment && !transfer && !deposit && !withdrawal && !preapproval) {
      logger.warn(
        'Transaction not found for MTN webhook',
        {
          externalId: webhookData.data.externalId,
          referenceId,
        }
      )
      return {
        status: 404,
        body: { error: 'Transaction not found' },
      }
    }

    // 4. Update status based on MTN status
    const newStatus =
      webhookData.data.status === 'SUCCESSFUL'
        ? 'COMPLETED'
        : ['FAILED', 'REJECTED', 'APPROVAL_REJECTED', 'CANCELLED'].includes(webhookData.data.status)
        ? 'FAILED'
        : 'PENDING'

    const webhookFinId = webhookData.data.financialTransactionId

    let userSettings = null
    let transactionId = null
    let transactionType = ''

    // Update payment
    if (payment) {
      payment = (await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus as any,
          financialTransactionId: webhookFinId || payment.financialTransactionId,
          metadata: {
            ...((payment.metadata as any) || {}),
            mtnResponse: webhookData.data,
            lastWebhookAt: new Date().toISOString(),
          },
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })) as any
      userSettings = (payment as any).apiKey?.user?.settings
      transactionId = (payment as any).id
      transactionType = 'payment'

      await emit({
        topic: 'payment.updated',
        data: { paymentId: payment!.id, status: newStatus },
      })
    }

    // Update transfer
    if (transfer) {
      transfer = await prisma.transfer.update({
        where: { id: transfer.id },
        data: {
          status: newStatus as any,
          financialTransactionId: webhookFinId || (transfer as any).financialTransactionId,
          metadata: {
            ...((transfer.metadata as any) || {}),
            mtnResponse: webhookData.data,
            lastWebhookAt: new Date().toISOString(),
          },
          completedAt: newStatus === 'COMPLETED' ? transfer.completedAt || new Date() : transfer.completedAt,
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
      userSettings = transfer.apiKey?.user?.settings
      transactionId = transfer.id
      transactionType = 'transfer'

      await emit({
        topic: 'transfer.updated',
        data: { transferId: transfer.id, status: newStatus },
      })
    }

    // Update deposit
    if (deposit) {
      const depositStatus = newStatus === 'COMPLETED' ? 'SUCCESSFUL' : newStatus
      deposit = await prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          status: depositStatus as any,
          financialTransactionId: webhookFinId || (deposit as any).financialTransactionId,
          metadata: {
            ...((deposit.metadata as any) || {}),
            mtnResponse: webhookData.data,
            lastWebhookAt: new Date().toISOString(),
          },
          completedAt: depositStatus === 'SUCCESSFUL' ? deposit.completedAt || new Date() : deposit.completedAt,
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
      userSettings = deposit.apiKey?.user?.settings
      transactionId = deposit.id
      transactionType = 'deposit'

      await emit({
        topic: 'deposit.updated',
        data: { depositId: deposit.id, status: depositStatus },
      })
    }

    // Update withdrawal
    if (withdrawal) {
      withdrawal = await (prisma as any).withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: newStatus as any,
          financialTransactionId: webhookFinId || (withdrawal as any).financialTransactionId,
          metadata: {
            ...((withdrawal.metadata as any) || {}),
            mtnResponse: webhookData.data,
            lastWebhookAt: new Date().toISOString(),
          },
          rawStatusResponse: webhookData.data as any,
          completedAt: newStatus === 'COMPLETED' ? withdrawal.completedAt || new Date() : withdrawal.completedAt,
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
      userSettings = withdrawal.apiKey?.user?.settings
      transactionId = withdrawal.id
      transactionType = 'withdrawal'

      await emit({
        topic: 'withdrawal.updated',
        data: { withdrawalId: withdrawal.id, status: newStatus },
      })
    }

    // Update preapproval
    if (preapproval) {
      let preapprovalStatus = 'PENDING'
      if (webhookData.data.status === 'SUCCESSFUL') {
        preapprovalStatus = 'APPROVED'
      } else if (webhookData.data.status === 'REJECTED' || webhookData.data.status === 'APPROVAL_REJECTED') {
        preapprovalStatus = 'REJECTED'
      } else if (webhookData.data.status === 'FAILED') {
        preapprovalStatus = 'FAILED'
      } else if (webhookData.data.status === 'CANCELLED') {
        preapprovalStatus = 'CANCELLED'
      }

      preapproval = await prisma.preApproval.update({
        where: { id: preapproval.id },
        data: {
          status: preapprovalStatus as any,
          metadata: {
            ...((preapproval.metadata as any) || {}),
            mtnResponse: webhookData.data,
            lastWebhookAt: new Date().toISOString(),
          },
          rawStatusResponse: webhookData.data as any,
          approvedAt: preapprovalStatus === 'APPROVED' ? new Date() : preapproval.approvedAt,
          cancelledAt: preapprovalStatus === 'CANCELLED' ? new Date() : preapproval.cancelledAt,
        },
        include: {
          apiKey: { include: { user: { include: { settings: true } } } },
        },
      })
      userSettings = (preapproval as any).apiKey?.user?.settings
      transactionId = preapproval.id
      transactionType = 'preapproval'
    }

    // 5. Store incoming webhook delivery
    const webhookDeliveryData = {
      url: `${env.API_URL}${env.API_PREFIX}/webhooks/mtn`,
      status: 'DELIVERED',
      provider: 'MTN',
      providerSignature: signature,
      payload: payload as any,
      response: { status: 'processed' } as any,
      deliveredAt: new Date(),
    }

    if (payment) {
      await prisma.webhookDelivery.create({
        data: { ...webhookDeliveryData, paymentId: payment.id } as any,
      })
    } else if (transfer) {
      await prisma.webhookDelivery.create({
        data: { ...webhookDeliveryData, transferId: transfer.id } as any,
      })
    } else if (deposit) {
      await prisma.webhookDelivery.create({
        data: { ...webhookDeliveryData, depositId: deposit.id } as any,
      })
    } else if (withdrawal) {
      await prisma.webhookDelivery.create({
        data: { ...webhookDeliveryData, withdrawalId: withdrawal.id } as any,
      })
    } else if (preapproval) {
      await prisma.webhookDelivery.create({
        data: { ...webhookDeliveryData, preapprovalId: preapproval.id } as any,
      })
    }

    // 6. Merchant webhook forwarding is handled by the ForwardMerchantWebhook event subscriber
    //    which listens to the *.updated events emitted above. No need to call queueWebhook here
    //    to avoid duplicate deliveries.

    logger.info(
      'MTN webhook processed successfully',
      {
        transactionId,
        transactionType,
        newStatus,
        referenceId,
      }
    )

    // Emit global webhook event
    await emit({
      topic: 'webhook.mtn.received',
      data: {
        transactionId,
        transactionType,
        status: newStatus,
        referenceId,
      },
    })

    return {
      status: 200,
      body: { received: true, status: 'processed' },
    }
  } catch (error: any) {
    logger.error('Error processing MTN webhook', { error: error.message, payload })
    return {
      status: 500,
      body: { error: 'Internal server error' },
    }
  }
}
