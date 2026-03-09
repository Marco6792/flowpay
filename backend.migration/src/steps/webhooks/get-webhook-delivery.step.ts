import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { apiKeyAuth } from '../../middleware/auth.middleware'

const paramsSchema = z.object({
  id: z.string(),
})

export const config: ApiRouteConfig = {
  name: 'GetWebhookDelivery',
  flows: ['webhook-management'],
  type: 'api',
  path: '/api/v1/webhooks/deliveries/:id',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Get full details for a specific webhook delivery',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const apiKeyId = req.apiKey!.id

    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id },
      include: {
        payment: { select: { apiKeyId: true, transactionId: true } },
        transfer: { select: { apiKeyId: true, transferId: true } },
        deposit: { select: { apiKeyId: true, depositId: true } },
        withdrawal: { select: { apiKeyId: true, withdrawId: true } as any },
        preapproval: { select: { apiKeyId: true, preApprovalId: true } },
      },
    })

    if (!delivery) {
      return {
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'Delivery not found' },
      }
    }

    const ownerApiKeyId =
      delivery.payment?.apiKeyId ||
      delivery.transfer?.apiKeyId ||
      delivery.deposit?.apiKeyId ||
      delivery.withdrawal?.apiKeyId ||
      delivery.preapproval?.apiKeyId

    if (ownerApiKeyId !== apiKeyId) {
      return {
        status: 403,
        body: { statusCode: 403, error: 'Forbidden', message: 'Not allowed' },
      }
    }

    const entity = delivery.paymentId
      ? 'payment'
      : delivery.transferId
        ? 'transfer'
        : delivery.depositId
          ? 'deposit'
          : delivery.withdrawalId
            ? 'withdrawal'
            : delivery.preapprovalId
              ? 'preapproval'
              : 'unknown'

    const payload: any = (delivery as any).payload || null

    return {
      status: 200,
      body: {
        id: delivery.id,
        url: delivery.url,
        status: delivery.status,
        attempts: delivery.attempts,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        deliveredAt: delivery.deliveredAt,
        lastError: delivery.lastError,
        providerSignature: delivery.providerSignature,
        response: delivery.response,
        payload,
        event: payload?.event || null,
        transactionId: payload?.transactionId || null,
        entity,
      },
    }
  } catch (error: any) {
    logger.error('Error getting webhook delivery', { error })
    return {
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      },
    }
  }
}
