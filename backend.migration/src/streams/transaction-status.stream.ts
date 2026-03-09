import { StreamConfig } from 'motia'
import { z } from 'zod'

export const transactionStatusSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  type: z.enum(['payment', 'transfer', 'deposit', 'withdrawal']),
  status: z.string(),
  previousStatus: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  provider: z.string().optional(),
  updatedAt: z.string(),
})

export type TransactionStatus = z.infer<typeof transactionStatusSchema>

export const config: StreamConfig = {
  name: 'transactionStatus',
  schema: transactionStatusSchema,
  baseConfig: { storageType: 'default' },
}
