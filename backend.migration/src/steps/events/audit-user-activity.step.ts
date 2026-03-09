import { EventConfig, FlowContext } from 'motia'
import { prisma } from '../../utils/database'

export const config: EventConfig = {
  name: 'AuditUserActivity',
  flows: ['authentication'],
  type: 'event',
  subscribes: ['user.registered', 'user.logged_in', 'apikey.created', 'apikey.revoked'],
  emits: [],
  description: 'Audit log for user authentication and API key activities',
}

export const handler = async (event: any, { logger }: FlowContext) => {
  const { topic, data } = event

  logger.info('User activity audit', { topic, data })

  try {
    // Log audit trail
    switch (topic) {
      case 'user.registered':
        logger.info('New user registered', {
          userId: data.userId,
          email: data.email,
          businessName: data.businessName,
        })
        break

      case 'user.logged_in':
        logger.info('User logged in', {
          userId: data.userId,
          email: data.email,
        })
        break

      case 'apikey.created':
        logger.info('API key created', {
          apiKeyId: data.apiKeyId,
          userId: data.userId,
          name: data.name,
        })
        break

      case 'apikey.revoked':
        logger.info('API key revoked', {
          apiKeyId: data.apiKeyId,
          userId: data.userId,
          name: data.name,
        })
        break

      default:
        logger.warn('Unknown user activity topic', { topic })
    }
  } catch (error: any) {
    logger.error('Error processing user activity audit', { error: error.message, topic })
  }
}
