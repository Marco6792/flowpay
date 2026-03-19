import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string(),
  API_PREFIX: z.string().default('/api/v1'),
  API_URL: z.string().default('http://localhost:5000'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.string().transform(Number).default(100),
  RATE_LIMIT_TIME_WINDOW: z.string().default('1m'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  // MTN MoMo API Configuration
  MTN_API_URL: z.string().optional(),
  MTN_API_KEY: z.string().optional(),
  MTN_API_SECRET: z.string().optional(),
  MTN_API_USER: z.string().optional(), // API User ID for sandbox
  MTN_TARGET_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  
  // MTN Subscription Keys for different products
  MTN_COLLECTION_SUBSCRIPTION_KEY: z.string().optional(),
  MTN_DISBURSEMENT_SUBSCRIPTION_KEY: z.string().optional(),
  MTN_REMITTANCE_SUBSCRIPTION_KEY: z.string().optional(),
  MTN_SUBSCRIPTION_KEY: z.string().optional(), // Legacy - kept for backward compatibility
  
  // MTN Callback Configuration
  MTN_CALLBACK_URL: z.string().url().optional(),
  MTN_PROVIDER_CALLBACK_HOST: z.string().optional(),
  ORANGE_API_URL: z.string().optional(),
  ORANGE_CLIENT_ID: z.string().optional(),
  ORANGE_CLIENT_SECRET: z.string().optional(),
  ORANGE_MERCHANT_KEY: z.string().optional(),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().default('flowpay_webhook_secret_2025'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function validateEnv(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);
  
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }
  
  return parsed.data;
}

export const env = validateEnv();