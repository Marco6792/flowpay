import { EventConfig, FlowContext } from 'motia'

export const config: EventConfig = {
  name: 'AuditAdminActivity',
  flows: ['admin-management'],
  type: 'event',
  subscribes: ['admin.logged_in', 'admin.created'],
  emits: [],
  description: 'Audit log for admin authentication and management activities',
}

export const handler = async (event: any, { logger }: FlowContext) => {
  const { topic, data } = event

  logger.info('Admin activity audit', { topic, data })

  try {
    switch (topic) {
      case 'admin.logged_in':
        logger.info('Admin logged in', {
          userId: data.userId,
          email: data.email,
          role: data.role,
        })
        break

      case 'admin.created':
        logger.info('New admin created', {
          adminId: data.adminId,
          email: data.email,
          role: data.role,
          createdBy: data.createdBy,
        })
        break

      default:
        logger.warn('Unknown admin activity topic', { topic })
    }
  } catch (error: any) {
    logger.error('Error processing admin activity audit', { error: error.message, topic })
  }
}
