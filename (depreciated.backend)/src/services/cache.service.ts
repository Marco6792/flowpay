import Redis from 'ioredis';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

export class CacheService {
  private redis: Redis | null = null;
  private localCache: Map<string, { data: any; expires: number }> = new Map();
  private connected = false;

  constructor() {
    logger.info('CacheService constructor called');
    if (env.REDIS_URL) {
      logger.info(`Redis URL found: ${env.REDIS_URL.replace(/:[^:@]+@/, ':****@')}`);
      this.initRedis();
    } else {
      logger.warn('Redis URL not configured, using in-memory cache only');
    }
  }

  private async initRedis() {
    try {
      logger.info('Initializing Redis connection...');
      this.redis = new Redis(env.REDIS_URL!, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error('Redis connection failed after 3 retries');
            return null;
          }
          return Math.min(times * 50, 2000);
        },
      });

      this.redis.on('connect', () => {
        this.connected = true;
        logger.info('Redis connected successfully');
      });

      this.redis.on('error', (error) => {
        logger.error({ error }, 'Redis connection error');
        this.connected = false;
      });

      this.redis.on('close', () => {
        this.connected = false;
        logger.info('Redis connection closed');
      });
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis');
      this.redis = null;
    }
  }

  /**
   * Get value from cache (L1: in-memory, L2: Redis)
   */
  async get<T>(key: string): Promise<T | null> {
    // L1 Cache: In-memory (fastest)
    const local = this.localCache.get(key);
    if (local && local.expires > Date.now()) {
      logger.debug({ key }, 'Cache hit (L1)');
      return local.data;
    }

    // L2 Cache: Redis (fast)
    if (this.redis && this.connected) {
      try {
        const cached = await this.redis.get(key);
        if (cached) {
          const data = JSON.parse(cached);
          // Populate L1 cache
          this.localCache.set(key, {
            data,
            expires: Date.now() + 30_000, // 30 second L1 TTL
          });
          logger.debug({ key }, 'Cache hit (L2)');
          return data;
        }
      } catch (error) {
        logger.error({ error, key }, 'Redis get error');
      }
    }

    logger.debug({ key }, 'Cache miss');
    return null;
  }

  /**
   * Set value in cache (both L1 and L2)
   */
  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    // Set L1 cache
    this.localCache.set(key, {
      data: value,
      expires: Date.now() + Math.min(ttlSeconds * 1000, 30_000), // Max 30s for L1
    });

    // Set L2 cache
    if (this.redis && this.connected) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
        logger.debug({ key, ttl: ttlSeconds }, 'Cache set');
      } catch (error) {
        logger.error({ error, key }, 'Redis set error');
      }
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string): Promise<void> {
    // Delete from L1
    this.localCache.delete(key);

    // Delete from L2
    if (this.redis && this.connected) {
      try {
        await this.redis.del(key);
        logger.debug({ key }, 'Cache deleted');
      } catch (error) {
        logger.error({ error, key }, 'Redis del error');
      }
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async delPattern(pattern: string): Promise<void> {
    // Clear matching keys from L1
    for (const key of this.localCache.keys()) {
      if (key.match(pattern)) {
        this.localCache.delete(key);
      }
    }

    // Clear from L2
    if (this.redis && this.connected) {
      try {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          logger.debug({ pattern, count: keys.length }, 'Cache pattern deleted');
        }
      } catch (error) {
        logger.error({ error, pattern }, 'Redis delPattern error');
      }
    }
  }

  /**
   * Clear all cache
   */
  async flush(): Promise<void> {
    // Clear L1
    this.localCache.clear();

    // Clear L2
    if (this.redis && this.connected) {
      try {
        await this.redis.flushdb();
        logger.info('Cache flushed');
      } catch (error) {
        logger.error({ error }, 'Redis flush error');
      }
    }
  }

  /**
   * Cache payment status
   */
  async cachePaymentStatus(paymentId: string, status: any, ttl = 60): Promise<void> {
    const key = `payment:status:${paymentId}`;
    await this.set(key, status, ttl);
  }

  /**
   * Get cached payment status
   */
  async getCachedPaymentStatus(paymentId: string): Promise<any | null> {
    const key = `payment:status:${paymentId}`;
    return this.get(key);
  }

  /**
   * Cache API key validation result
   */
  async cacheApiKeyValidation(apiKey: string, result: any, ttl = 300): Promise<void> {
    const key = `apikey:valid:${apiKey}`;
    await this.set(key, result, ttl);
  }

  /**
   * Get cached API key validation
   */
  async getCachedApiKeyValidation(apiKey: string): Promise<any | null> {
    const key = `apikey:valid:${apiKey}`;
    return this.get(key);
  }

  /**
   * Implement rate limiting using Redis
   */
  async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    if (!this.redis || !this.connected) {
      // Fallback to simple in-memory rate limiting
      const now = Date.now();
      const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;
      const current = this.localCache.get(windowKey);

      if (!current || current.expires < now) {
        this.localCache.set(windowKey, { data: 1, expires: now + windowSeconds * 1000 });
        return { allowed: true, remaining: limit - 1, resetAt: new Date(now + windowSeconds * 1000) };
      }

      if (current.data >= limit) {
        return { allowed: false, remaining: 0, resetAt: new Date(current.expires) };
      }

      current.data++;
      return { allowed: true, remaining: limit - current.data, resetAt: new Date(current.expires) };
    }

    try {
      const now = Date.now();
      const window = Math.floor(now / (windowSeconds * 1000));
      const redisKey = `ratelimit:${key}:${window}`;

      const multi = this.redis.multi();
      multi.incr(redisKey);
      multi.expire(redisKey, windowSeconds);
      const results = await multi.exec();

      if (!results) {
        return { allowed: true, remaining: limit - 1, resetAt: new Date(now + windowSeconds * 1000) };
      }

      const count = results[0][1] as number;
      const resetAt = new Date((window + 1) * windowSeconds * 1000);

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAt,
      };
    } catch (error) {
      logger.error({ error, key }, 'Rate limit check error');
      return { allowed: true, remaining: limit - 1, resetAt: new Date(Date.now() + windowSeconds * 1000) };
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.connected = false;
      logger.info('Redis connection closed');
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();
