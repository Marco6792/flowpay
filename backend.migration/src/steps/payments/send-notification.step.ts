import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import { ProviderFactory } from '../../services/providers/provider.factory'
import { MTNMobileMoneyProvider } from '../../services/providers/mtn.provider'

const paramsSchema = z.object({
  id: z.string(),
})

const bodySchema = z.object({
  message: z.string().max(160),
})

export const config: ApiRouteConfig = {
  name: 'SendPaymentNotification',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/:id/notify',
  method: 'POST',
  emits: [],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Send notification for a payment (MTN only)',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  try {
    const { id } = req.params as z.infer<typeof paramsSchema>
    const { message } = req.body as z.infer<typeof bodySchema>
    const apiKeyId = req.apiKey!.id

    // Find the payment
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id }, { transactionId: id }],
        apiKeyId,
      },
    })

    if (!payment) {
      return {
        status: 404,
        body: {
          statusCode: 404,
          error: 'Not Found',
          message: 'Payment not found',
        },
      }
    }

    if (!payment.providerReference) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Payment does not have a provider reference',
        },
      }
    }

    // Get the provider
    const provider = ProviderFactory.getProvider((payment.provider || 'MTN').toLowerCase() as any)

    // Send notification (only MTN supports this currently)
    if (provider instanceof MTNMobileMoneyProvider) {
      const result = await provider.sendNotification(payment.providerReference, message)

      // Store notification in database
      await prisma.paymentNotification.create({
        data: {
          paymentId: payment.id,
          message: message.substring(0, 160),
          delivered: result.success,
          deliveredAt: result.success ? new Date() : null,
          provider: payment.provider,
          response: result as any,
        },
      })

      if (result.success) {
        return {
          status: 200,
          body: {
            success: true,
            message: 'Notification sent successfully',
            paymentId: payment.id,
          },
        }
      } else {
        return {
          status: 400,
          body: {
            statusCode: 400,
            error: 'Bad Request',
            message: result.message,
          },
        }
      }
    } else {
      return {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Provider does not support notifications',
        },
      }
    }
  } catch (error: any) {
    logger.error('Error sending notification', { error: error.message })
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
