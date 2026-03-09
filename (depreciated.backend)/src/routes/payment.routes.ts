import { FastifyInstance } from 'fastify';
import { PaymentController } from '../controllers/payment.controller.ts';
import { createPaymentSchema } from '../utils/validation.ts';

const paymentController = new PaymentController();

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  // All payment routes need auth (middleware runs globally)
  // Create payment
  app.post('/payments', {
    schema: {
      body: {
        type: 'object',
        properties: {
          from: { type: 'string', pattern: '^237[0-9]{9}@cameroon$' },
          to: { type: 'string', pattern: '^237[0-9]{9}@cameroon$' },
          amount: { type: 'number', minimum: 100, maximum: 5000000 },
          timestamp: { type: 'string', format: 'date-time' },
          id: { type: 'string', maxLength: 100 }
        },
        required: ['from', 'to', 'amount', 'timestamp']
      }
    },
    preHandler: async (request, reply) => {
      // Validate with Zod for better error messages
      try {
        createPaymentSchema.parse(request.body);
      } catch (error: any) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          details: error.errors
        });
      }
    }
  }, (request, reply) => paymentController.create(request, reply));

  // Get payment by transaction ID
  app.get('/payments/:transactionId', (request, reply) => paymentController.getByTransactionId(request, reply));

  // List payments
  app.get('/payments', (request, reply) => paymentController.list(request, reply));

  // Get payment statistics
  app.get('/payments/stats', (request, reply) => paymentController.getStats(request, reply));

  // Cancel payment
  app.post('/payments/:transactionId/cancel', (request, reply) => paymentController.cancel(request, reply));

  // Send notification for a payment
  app.post('/payments/:id/notify', (request, reply) => paymentController.sendNotification(request, reply));

  // Refund a payment
  app.post('/payments/:id/refund', (request, reply) => paymentController.refund(request, reply));

  // Get refund status
  app.get('/refunds/:refundId/status', (request, reply) => paymentController.getRefundStatus(request, reply));

  // List refunds for a payment
  app.get('/payments/:id/refunds', (request, reply) => paymentController.listRefunds(request, reply));

  // Withdraw (Request-to-Withdraw)
  app.post('/withdraw', {
    schema: {
      body: {
        type: 'object',
        properties: {
          accountId: { type: 'string', pattern: '^[0-9]{11}@cameroon$' },
          amount: { type: 'number', minimum: 100, maximum: 5000000 },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          description: { type: 'string', maxLength: 500 },
          id: { type: 'string', maxLength: 100 }
        },
        required: ['accountId', 'amount', 'currency']
      }
    }
  }, (request, reply) => paymentController.requestWithdraw(request, reply));

  // Get withdraw status
  app.get('/withdraw/:withdrawId', (request, reply) => paymentController.getWithdrawStatus(request, reply));
}
