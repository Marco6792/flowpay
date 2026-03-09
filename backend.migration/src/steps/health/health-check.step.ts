import { ApiRouteConfig, FlowContext } from 'motia'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'HealthCheck',
  flows: ['system-health'],
  type: 'api',
  path: '/api/v1/health',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware],
  description: 'Health check endpoint to verify Motia backend is running',
}

export const handler = async (_req: any, _ctx: FlowContext) => {
  return {
    status: 200,
    body: {
      status: 'ok',
      service: 'FlowPay Backend (Motia)',
      timestamp: new Date().toISOString(),
      version: '2.0.0-motia',
    },
  }
}
