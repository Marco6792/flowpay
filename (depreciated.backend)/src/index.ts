import { buildApp } from './app.ts';
import { env } from './config/env.ts';
import { logger } from './utils/logger.ts';
import { cacheService } from './services/cache.service.ts';

async function start() {
  try {
    // Initialize cache service (triggers Redis connection)
    logger.info('Initializing cache service...');
    // Access the cache service to trigger initialization
    await cacheService.get('startup-test');

    const app = await buildApp();

    // Silence the default "Server listening" message
    const originalInfo = app.log.info.bind(app.log);
    app.log.info = function(msg: any, ...args: any[]) {
      if (typeof msg === 'string' && msg.includes('Server listening')) {
        return;
      }
      return originalInfo(msg, ...args);
    };

    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    const displayHost = env.HOST === '0.0.0.0' ? 'localhost' : env.HOST;
    logger.info(`🚀 FlowPay API server running at http://${displayHost}:${env.PORT}`);
    logger.info(`📚 Documentation available at http://${displayHost}:${env.PORT}/documentation`);
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

start();
