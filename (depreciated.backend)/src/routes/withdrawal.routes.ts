import { FastifyInstance } from 'fastify';
import { withdrawalController } from '../controllers/withdrawal.controller.ts';

export async function withdrawalRoutes(fastify: FastifyInstance) {
  // Authentication is handled globally in app.ts

  // Create withdrawal
  fastify.post('/', withdrawalController.createWithdrawal.bind(withdrawalController));

  // Get withdrawal by ID
  fastify.get('/:withdrawId', withdrawalController.getWithdrawal.bind(withdrawalController));

  // Get withdrawal status
  fastify.get('/:withdrawId/status', withdrawalController.getWithdrawalStatus.bind(withdrawalController));

  // List withdrawals
  fastify.get('/', withdrawalController.listWithdrawals.bind(withdrawalController));
}
