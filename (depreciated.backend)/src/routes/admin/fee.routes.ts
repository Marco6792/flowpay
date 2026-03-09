import { FastifyInstance } from 'fastify';
import { FeeController } from '../../controllers/fee.controller.ts';
import { requireAdmin, requireSuperAdmin, requirePermission } from '../../middleware/admin.middleware.ts';

export async function feeRoutes(fastify: FastifyInstance) {
  const feeController = new FeeController();

  // All routes require admin authentication
  fastify.addHook('onRequest', requireAdmin);

  // Fee Structure Management (Super Admin only)
  fastify.post(
    '/structures',
    {
      onRequest: [requireSuperAdmin],
    },
    async (request, reply) => feeController.createFeeStructure(request as any, reply)
  );

  fastify.put(
    '/structures/:id',
    {
      onRequest: [requireSuperAdmin],
    },
    async (request, reply) => feeController.updateFeeStructure(request as any, reply)
  );

  fastify.get(
    '/structures',
    async (request, reply) => feeController.listFeeStructures(request as any, reply)
  );

  // Merchant Fee Assignment (Admin can assign)
  fastify.post(
    '/merchants/assign',
    {
      onRequest: [requirePermission('fees.assign')],
    },
    async (request, reply) => feeController.assignMerchantFee(request as any, reply)
  );

  fastify.get(
    '/merchants/:userId/history',
    async (request, reply) => feeController.getMerchantFeeHistory(request as any, reply)
  );

  fastify.get(
    '/merchants/:userId/current',
    async (request, reply) => feeController.getMerchantCurrentFee(request as any, reply)
  );

  // Fee Calculation
  fastify.post(
    '/calculate',
    async (request, reply) => feeController.calculateFee(request as any, reply)
  );

  // Volume Tiers (Super Admin only)
  fastify.post(
    '/volume-tiers',
    {
      onRequest: [requireSuperAdmin],
    },
    async (request, reply) => feeController.createVolumeTier(request as any, reply)
  );

  // Revenue Reports
  fastify.get(
    '/revenue',
    {
      onRequest: [requirePermission('reports.view')],
    },
    async (request, reply) => feeController.getRevenueReport(request as any, reply)
  );
}
