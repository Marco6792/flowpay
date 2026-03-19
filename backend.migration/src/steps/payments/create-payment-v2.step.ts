import { ApiRouteConfig, FlowContext } from 'motia'
import { z } from 'zod'
import { ProviderFactory, ProviderType } from '../../services/providers/provider.factory'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'
import crypto from 'crypto'

const bodySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional(),
  from: z.string(),
  description: z.string().optional(),
  externalTransactionId: z.string().optional(),
  customerReference: z.string().optional(),
  serviceProviderUserName: z.string().optional(),
  couponId: z.string().optional(),
  productId: z.string().optional(),
  productOfferingId: z.string().optional(),
  receiverMessage: z.string().optional(),
  senderNote: z.string().optional(),
  maxNumberOfRetries: z.number().optional(),
  includeSenderCharges: z.boolean().optional(),
  provider: z.enum(['MTN', 'ORANGE']).optional(),
})

export const config: ApiRouteConfig = {
  name: 'CreatePaymentV2',
  flows: ['payment-processing'],
  type: 'api',
  path: '/api/v1/payments/v2',
  method: 'POST',
  emits: ['payment.created'],
  bodySchema,
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'Create a payment using MTN Collection v2.0 API',
}

export const handler = async (req: any, { logger, emit }: FlowContext<any>) => {
  try {
    const data = req.body as z.infer<typeof bodySchema>
    const providerName = (data.provider || 'MTN').toLowerCase() as ProviderType
    const provider = ProviderFactory.getProvider(providerName)
    if (!provider) {
      return {
        status: 400,
        body: { success: false, error: 'Provider not found' },
      }
    }

    const transactionId = crypto.randomUUID()

    const result = await provider.initiatePayment({
      transactionId,
      from: data.from,
      to: 'merchant',
      amount: data.amount,
      currency: data.currency || 'XAF',
      description: data.description,
      providerMode: 'mtn-v2',
      providerOptions: {
        externalTransactionId: data.externalTransactionId || transactionId,
        customerReference: data.customerReference,
        serviceProviderUserName: data.serviceProviderUserName,
        couponId: data.couponId,
        productId: data.productId,
        productOfferingId: data.productOfferingId,
        receiverMessage: data.receiverMessage,
        senderNote: data.senderNote,
        maxNumberOfRetries: data.maxNumberOfRetries,
        includeSenderCharges: data.includeSenderCharges,
      },
    })

    if (result.success) {
      await emit({
        topic: 'payment.created',
        data: {
          paymentId: transactionId,
          transactionId,
          status: result.status,
          provider: providerName,
          providerReference: result.providerTransactionId,
          amount: data.amount,
          currency: data.currency || 'XAF',
          version: 'v2',
        },
      })
    }

    return {
      status: result.success ? 201 : 400,
      body: {
        success: result.success,
        data: {
          paymentId: transactionId,
          providerTransactionId: result.providerTransactionId,
          status: result.status,
          financialTransactionId: result.financialTransactionId,
          message: result.message,
          version: 'v2',
        },
      },
    }
  } catch (error: any) {
    logger.error('Failed to create v2 payment', { error: error.message })
    return {
      status: 500,
      body: {
        success: false,
        error: 'Internal server error',
      },
    }
  }
}
