import { FastifyRequest, FastifyReply } from 'fastify';
import { FeeService } from '../services/fee.service.ts';
import { logger } from '../utils/logger.ts';
import { z } from 'zod';

// Validation schemas
const createFeeStructureSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  percentage: z.number().min(0).max(100),
  minFee: z.number().min(0),
  maxFee: z.number().min(0),
  fixedFee: z.number().min(0).optional(),
  isDefault: z.boolean().optional(),
});

const updateFeeStructureSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  percentage: z.number().min(0).max(100).optional(),
  minFee: z.number().min(0).optional(),
  maxFee: z.number().min(0).optional(),
  fixedFee: z.number().min(0).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const assignMerchantFeeSchema = z.object({
  userId: z.string().cuid(),
  feeStructureId: z.string().cuid(),
  customPercentage: z.number().min(0).max(100).optional(),
  customMinFee: z.number().min(0).optional(),
  customMaxFee: z.number().min(0).optional(),
  notes: z.string().optional(),
});

const createVolumeTierSchema = z.object({
  name: z.string().min(1).max(100),
  minVolume: z.number().min(0),
  maxVolume: z.number().min(0).optional(),
  percentage: z.number().min(0).max(100),
  minFee: z.number().min(0),
  maxFee: z.number().min(0),
});

export class FeeController {
  /**
   * Create a new fee structure
   * POST /admin/fees/structures
   */
  async createFeeStructure(
    request: FastifyRequest<{ Body: z.infer<typeof createFeeStructureSchema> }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = createFeeStructureSchema.parse(request.body);

      const feeStructure = await FeeService.createFeeStructure({
        ...validatedData,
        createdBy: (request as any).user?.id,
      });

      logger.info({
        feeStructureId: feeStructure?.id,
        name: validatedData.name,
        adminId: (request as any).user?.id,
      }, 'Fee structure created');

      return reply.status(201).send({
        success: true,
        data: feeStructure,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Error creating fee structure');
      return reply.status(500).send({
        success: false,
        error: 'Failed to create fee structure',
      });
    }
  }

  /**
   * Update fee structure
   * PUT /admin/fees/structures/:id
   */
  async updateFeeStructure(
    request: FastifyRequest<{
      Params: { id: string };
      Body: z.infer<typeof updateFeeStructureSchema>;
    }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params;
      const validatedData = updateFeeStructureSchema.parse(request.body);

      const feeStructure = await FeeService.updateFeeStructure(id, validatedData);

      logger.info({
        feeStructureId: id,
        updates: validatedData,
        adminId: (request as any).user?.id,
      }, 'Fee structure updated');

      return reply.send({
        success: true,
        data: feeStructure,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Error updating fee structure');
      return reply.status(500).send({
        success: false,
        error: 'Failed to update fee structure',
      });
    }
  }

  /**
   * List all fee structures
   * GET /admin/fees/structures
   */
  async listFeeStructures(
    request: FastifyRequest<{
      Querystring: { includeInactive?: boolean };
    }>,
    reply: FastifyReply
  ) {
    try {
      const { includeInactive = false } = request.query;

      const structures = await FeeService.listFeeStructures(includeInactive);

      return reply.send({
        success: true,
        data: structures || [],
      });
    } catch (error) {
      logger.error({ error }, 'Error listing fee structures');
      return reply.status(500).send({
        success: false,
        error: 'Failed to list fee structures',
      });
    }
  }

  /**
   * Assign fee structure to merchant
   * POST /admin/fees/merchants/assign
   */
  async assignMerchantFee(
    request: FastifyRequest<{ Body: z.infer<typeof assignMerchantFeeSchema> }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = assignMerchantFeeSchema.parse(request.body);

      const merchantFee = await FeeService.assignMerchantFee({
        ...validatedData,
        createdBy: (request as any).user?.id,
      });

      logger.info({
        userId: validatedData.userId,
        feeStructureId: validatedData.feeStructureId,
        adminId: (request as any).user?.id,
      }, 'Merchant fee assigned');

      return reply.status(201).send({
        success: true,
        data: merchantFee,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Error assigning merchant fee');
      return reply.status(500).send({
        success: false,
        error: 'Failed to assign merchant fee',
      });
    }
  }

  /**
   * Get merchant fee history
   * GET /admin/fees/merchants/:userId/history
   */
  async getMerchantFeeHistory(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) {
    try {
      const { userId } = request.params;

      const history = await FeeService.getMerchantFeeHistory(userId);

      return reply.send({
        success: true,
        data: history || [],
      });
    } catch (error) {
      logger.error({ error }, 'Error getting merchant fee history');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get merchant fee history',
      });
    }
  }

  /**
   * Calculate fee preview
   * POST /admin/fees/calculate
   */
  async calculateFee(
    request: FastifyRequest<{
      Body: { amount: number; userId: string };
    }>,
    reply: FastifyReply
  ) {
    try {
      const { amount, userId } = request.body;

      if (!amount || amount <= 0) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid amount',
        });
      }

      const calculation = await FeeService.calculateFee(amount, userId);
      const monthlyVolume = await FeeService.calculateMonthlyVolume(userId);

      return reply.send({
        success: true,
        data: {
          ...calculation,
          monthlyVolume,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error calculating fee');
      return reply.status(500).send({
        success: false,
        error: 'Failed to calculate fee',
      });
    }
  }

  /**
   * Get merchant's current fee structure
   * GET /admin/fees/merchants/:userId/current
   */
  async getMerchantCurrentFee(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) {
    try {
      const { userId } = request.params;

      const structure = await FeeService.getMerchantFeeStructure(userId);
      const monthlyVolume = await FeeService.calculateMonthlyVolume(userId);

      return reply.send({
        success: true,
        data: {
          structure,
          monthlyVolume,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error getting merchant current fee');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get merchant current fee',
      });
    }
  }

  /**
   * Create volume tier
   * POST /admin/fees/volume-tiers
   */
  async createVolumeTier(
    request: FastifyRequest<{ Body: z.infer<typeof createVolumeTierSchema> }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = createVolumeTierSchema.parse(request.body);

      // This would need to be implemented in FeeService
      const tier = await (FeeService as any).createVolumeTier?.(validatedData);

      logger.info({
        tierName: validatedData.name,
        adminId: (request as any).user?.id,
      }, 'Volume tier created');

      return reply.status(201).send({
        success: true,
        data: tier,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Error creating volume tier');
      return reply.status(500).send({
        success: false,
        error: 'Failed to create volume tier',
      });
    }
  }

  /**
   * Get fee revenue report
   * GET /admin/fees/revenue
   */
  async getRevenueReport(
    request: FastifyRequest<{
      Querystring: {
        startDate?: string;
        endDate?: string;
        groupBy?: 'day' | 'week' | 'month';
      };
    }>,
    reply: FastifyReply
  ) {
    try {
      const { startDate, endDate, groupBy = 'day' } = request.query;

      // Calculate revenue from fees
      const report = await (FeeService as any).getRevenueReport?.({
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        groupBy,
      });

      return reply.send({
        success: true,
        data: report || {
          totalRevenue: 0,
          totalTransactions: 0,
          averageFee: 0,
          breakdown: [],
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error getting revenue report');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get revenue report',
      });
    }
  }
}
