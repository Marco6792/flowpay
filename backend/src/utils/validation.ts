import { z } from 'zod';

const cameroonPhonePattern = /^237[0-9]{9}@cameroon$/;

export const createPaymentSchema = z.object({
  from: z.string().regex(cameroonPhonePattern, 'Invalid Cameroon phone format'),
  to: z.string().regex(cameroonPhonePattern, 'Invalid Cameroon phone format'),
  amount: z.number().min(100).max(5000000),
  timestamp: z.string().datetime(),
  id: z.string().max(100).optional(),
  provider: z.string().optional(),
  providerMode: z.string().optional(), // e.g., 'mtn-v2'
  providerOptions: z.record(z.any()).optional(),
});

export const getPaymentSchema = z.object({
  id: z.string(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type GetPaymentInput = z.infer<typeof getPaymentSchema>;
