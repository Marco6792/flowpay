import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { env } from '../config/env';

const isDatabaseUnavailableError = (error: unknown): boolean => {
  const err = error as { code?: string; message?: string };
  return err?.code === 'P1001' || Boolean(err?.message?.includes("Can't reach database server"));
};

// Create a singleton instance with logging
class PrismaService {
  private static instance: PrismaClient | null = null;

  static getInstance(): PrismaClient {
    if (!PrismaService.instance) {
      PrismaService.instance = new PrismaClient({
        log: [
          {
            emit: 'event',
            level: 'query',
          },
          {
            emit: 'event',
            level: 'error',
          },
          {
            emit: 'event',
            level: 'info',
          },
          {
            emit: 'event',
            level: 'warn',
          },
        ],
      });

      // Log all queries in development
      if (env.NODE_ENV === 'development') {
        (PrismaService.instance.$on as any)('query', (e: { query: string; params: string; duration: number }) => {
          logger.debug({
            query: e.query,
            params: e.params,
            duration: e.duration,
          }, 'Database query executed');
        });
      }

      // Log errors
      (PrismaService.instance.$on as any)('error', (e: { message: string; target: string }) => {
        if (isDatabaseUnavailableError(e)) {
          logger.warn({
            message: e.message,
            target: e.target,
          }, 'Database temporarily unavailable');
          return;
        }

        logger.error({
          message: e.message,
          target: e.target,
        }, 'Database error');
      });

      // Log info
      (PrismaService.instance.$on as any)('info', (e: { message: string }) => {
        logger.info({
          message: e.message,
        }, 'Database info');
      });

      // Log warnings
      (PrismaService.instance.$on as any)('warn', (e: { message: string }) => {
        logger.warn({
          message: e.message,
        }, 'Database warning');
      });

      // Connection logging with retry
      this.connectWithRetry();

      // Graceful shutdown
      process.on('beforeExit', async () => {
        logger.info('Closing database connection...');
        await PrismaService.instance?.$disconnect();
        logger.info('Database connection closed');
      });
    }

    return PrismaService.instance;
  }

  static async disconnect(): Promise<void> {
    if (PrismaService.instance) {
      await PrismaService.instance.$disconnect();
      PrismaService.instance = null;
      logger.info('Database disconnected');
    }
  }

  static async checkConnection(): Promise<boolean> {
    try {
      const prisma = PrismaService.getInstance();
      await prisma.$queryRaw`SELECT 1`;
      logger.info('Database health check passed');
      return true;
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      return false;
    }
  }

  private static async connectWithRetry(retries = 5, delay = 5000): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        if (!PrismaService.instance) return;

        await PrismaService.instance.$connect();
        logger.info('✅ Database connected successfully');

        const dbInfo = {
          database: env.DATABASE_URL.split('@')[1]?.split('/')[1]?.split('?')[0] || 'unknown',
          host: env.DATABASE_URL.split('@')[1]?.split(':')[0] || 'unknown',
        };
        logger.info(dbInfo, 'Database connection details');
        return;
      } catch (error: unknown) {
        const isLastRetry = i === retries - 1;

        if (isDatabaseUnavailableError(error)) {
          logger.warn({
            attempt: i + 1,
            maxRetries: retries,
            nextRetryIn: isLastRetry ? 'none' : `${delay / 1000}s`,
          }, '⚠️ Database connection failed, PostgreSQL might not be running');

          if (!isLastRetry) {
            logger.info('Waiting before retry...');
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error('❌ Database connection failed after all retries');
            logger.info('💡 To start PostgreSQL:');
            logger.info('   - Using Docker: docker compose up -d');
            logger.info('   - Using system: sudo systemctl start postgresql');
            logger.info('   - Check connection string in .env file');

            // Don't exit immediately in development, allow app to run without DB
            if (env.NODE_ENV === 'production') {
              process.exit(1);
            } else {
              logger.warn('⚠️ Running in development mode without database connection');
            }
          }
        } else {
          logger.error({ error }, '❌ Database connection error');
          if (isLastRetry && env.NODE_ENV === 'production') {
            process.exit(1);
          }
        }
      }
    }
  }
}

// Export singleton instance
export const prisma = PrismaService.getInstance();

// Export the service class for testing purposes
export { PrismaService };
export { isDatabaseUnavailableError };
