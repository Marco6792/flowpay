import { ApiRouteConfig, FlowContext } from 'motia'
import { PrismaService } from '../../utils/database'
import { coreMiddleware } from '../../middlewares/core.middleware'

export const config: ApiRouteConfig = {
  name: 'HealthReady',
  flows: ['system-health'],
  type: 'api',
  path: '/api/v1/health/ready',
  method: 'GET',
  emits: [],
  middleware: [coreMiddleware],
  description: 'Readiness check endpoint to verify DB and Redis connectivity',
}

export const handler = async (_req: any, { logger }: FlowContext) => {
  try {
    const isConnected = await PrismaService.checkConnection()

    if (isConnected) {
      return {
        status: 200,
        body: {
          status: 'ready',
          database: 'connected',
          timestamp: new Date().toISOString(),
        },
      }
    } else {
      logger.warn('Database is not connected')
      return {
        status: 503,
        body: {
          status: 'not ready',
          database: 'disconnected',
          timestamp: new Date().toISOString(),
        },
      }
    }
  } catch (error: any) {
    logger.error('Health ready check failed', { error: error.message })
    return {
      status: 503,
      body: {
        status: 'not ready',
        database: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    }
  }
}
