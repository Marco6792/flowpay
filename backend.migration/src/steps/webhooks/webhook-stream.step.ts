import { ApiRouteConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'
import { apiKeyAuth } from '../../middleware/auth.middleware'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'WebhookStream',
  flows: ['webhooks'],
  type: 'api',
  path: '/api/v1/webhooks/stream',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware, apiKeyAuth],
  description: 'SSE stream of webhook delivery events for real-time monitoring',
}

export const handler = async (req: any, { logger }: FlowContext) => {
  // Return SSE response headers and setup streaming
  const reply = req.raw.res
  const apiKeyId = req.apiKey!.id

  reply.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'X-API-Key, Authorization, Content-Type',
    'Vary': 'Origin',
  })

  const write = (event: any) => {
    try {
      reply.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch (error: any) {
      logger.error('Failed to write SSE event', { error: error.message })
    }
  }

  // Send keep-alive ping every 15 seconds
  const ping = setInterval(() => {
    try {
      reply.write(': ping\n\n')
    } catch (error: any) {
      clearInterval(ping)
    }
  }, 15000)

  let lastTs = new Date(Date.now() - 60_000) // Last minute

  // Poll for new webhook deliveries every 1.2 seconds
  const timer = setInterval(async () => {
    try {
      const deliveries = await prisma.webhookDelivery.findMany({
        where: {
          updatedAt: { gt: lastTs },
          OR: [
            { payment: { is: { apiKeyId } } },
            { transfer: { is: { apiKeyId } } },
            { deposit: { is: { apiKeyId } } },
            { withdrawal: { is: { apiKeyId } } },
            { preapproval: { is: { apiKeyId } } },
          ],
        },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      })

      if (deliveries.length) {
        lastTs = deliveries[deliveries.length - 1].updatedAt
        write({
          type: 'deliveries',
          items: deliveries.map((d) => {
            const payload: any = (d as any).payload || null
            return {
              id: d.id,
              url: d.url,
              status: d.status,
              attempts: d.attempts,
              createdAt: d.createdAt,
              updatedAt: d.updatedAt,
              deliveredAt: d.deliveredAt,
              lastError: d.lastError,
              event: payload?.event || null,
              transactionId: payload?.transactionId || null,
              payloadStatus: payload?.status || null,
              entity: d.paymentId
                ? 'payment'
                : d.transferId
                ? 'transfer'
                : d.depositId
                ? 'deposit'
                : d.withdrawalId
                ? 'withdrawal'
                : d.preapprovalId
                ? 'preapproval'
                : 'unknown',
            }
          }),
        })
      }
    } catch (error: any) {
      write({ type: 'error', message: error?.message || 'stream error' })
    }
  }, 1200)

  // Cleanup on client disconnect
  req.raw.req.on('close', () => {
    clearInterval(timer)
    clearInterval(ping)
    logger.info('Webhook stream client disconnected')
  })

  // Return empty to keep connection open
  return { __sse_stream: true }
}
