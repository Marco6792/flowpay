import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger.ts';

import { WebhookService } from '../services/webhook.service.ts';
import { MTNMobileMoneyProvider } from '../services/providers/mtn.provider.ts';
import { env } from '../config/env.ts';
import { prisma } from '../utils/database.ts';
import crypto from 'crypto';

// MTN webhook payload schema
const mtnWebhookSchema = z.object({
  financialTransactionId: z.string().optional(),
  externalId: z.string(),
  amount: z.string(),
  currency: z.string(),
  payer: z.object({
    partyIdType: z.string(),
    partyId: z.string()
  }).optional(),
  payee: z.object({
    partyIdType: z.string(),
    partyId: z.string()
  }).optional(),
  status: z.enum(['SUCCESSFUL', 'FAILED', 'PENDING', 'REJECTED', 'APPROVAL_REJECTED', 'CANCELLED']),
  reason: z.string().optional()
});

// Internal webhook event schema
const webhookEventSchema = z.object({
  event: z.enum([
    'payment.completed', 'payment.failed', 'payment.refunded', 'payment.updated',
    'transfer.completed', 'transfer.failed', 'transfer.updated', 'transfer.created',
    'deposit.completed', 'deposit.failed', 'deposit.updated', 'deposit.created',
    'withdrawal.completed', 'withdrawal.failed', 'withdrawal.updated', 'withdrawal.created',
    'preapproval.created', 'preapproval.approved', 'preapproval.rejected', 'preapproval.expired', 'preapproval.cancelled', 'preapproval.failed'
  ]),
  paymentId: z.string().optional(),
  transferId: z.string().optional(),
  depositId: z.string().optional(),
  withdrawalId: z.string().optional(),
  preapprovalId: z.string().optional(),
  timestamp: z.string().datetime(),
  data: z.record(z.any()).optional(),
});

export async function webhookRoutes(app: FastifyInstance): Promise<void> {

  // Generic webhook endpoint for internal notifications
  app.post('/webhooks', async (request, _reply) => {
    logger.info({
      body: request.body,
      headers: request.headers
    }, 'Received generic webhook notification');

    // For now, just acknowledge receipt
    // This endpoint is used by internal webhook service for merchant notifications
    return { received: true, message: 'Webhook notification received' };
  });

  // MTN webhook endpoint
  app.post('/webhooks/mtn', async (request, reply) => {
    const payload = request.body;
    const signature = request.headers['x-mtn-signature'] as string;

    logger.info({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: payload,
      signature: signature
    }, 'DEBUG: MTN webhook received - all details');
    const referenceId = request.headers['x-reference-id'] as string;

    logger.info({
      payload,
      referenceId,
      hasSignature: !!signature,
      provider: 'mtn'
    }, 'Received MTN webhook');

    try {
      // 1. Verify signature (production only)
      if (env.NODE_ENV === 'production' && signature) {
        const mtnProvider = new MTNMobileMoneyProvider();
        const isValid = mtnProvider.verifyWebhook(payload, signature);

        if (!isValid) {
          logger.warn({ referenceId }, 'Invalid MTN webhook signature');
          return reply.status(401).send({ error: 'Invalid signature' });
        }
      }

      // 2. Parse and validate MTN payload
      const webhookData = mtnWebhookSchema.safeParse(payload);
      if (!webhookData.success) {
        logger.error({
          error: webhookData.error,
          payload
        }, 'Invalid MTN webhook payload');
        return reply.status(400).send({ error: 'Invalid payload' });
      }

      // 3. Find payment, transfer, or deposit by external ID or provider reference
      let payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { transactionId: webhookData.data.externalId },
            { providerReference: referenceId }
          ]
        },
        include: {
          apiKey: {
            include: {
              user: {
                include: {
                  settings: true
                }
              }
            }
          }
        }
      });

      let transfer = null;
      let deposit = null;

      if (!payment) {
        // Try to find transfer
        transfer = await prisma.transfer.findFirst({
          where: {
            OR: [
              { transferId: webhookData.data.externalId },
              { providerReference: referenceId }
            ]
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });
      }

      let preapproval = null;

      if (!payment && !transfer) {
        // Try to find deposit
        deposit = await prisma.deposit.findFirst({
          where: {
            OR: [
              { depositId: webhookData.data.externalId },
              { providerReference: referenceId }
            ]
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });
      }

      let withdrawal = null;

      if (!payment && !transfer && !deposit) {
        // Try to find withdrawal
        logger.info({
          externalId: webhookData.data.externalId,
          referenceId: referenceId,
          webhookData: webhookData.data
        }, 'DEBUG: Searching for withdrawal with webhook data');

        withdrawal = await (prisma as any).withdrawal.findFirst({
          where: {
            OR: [
              { withdrawId: webhookData.data.externalId },
              { providerReference: referenceId }
            ]
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });

        logger.info({
          found: !!withdrawal,
          withdrawalId: withdrawal?.withdrawId,
          withdrawalDbId: withdrawal?.id,
          providerReference: withdrawal?.providerReference
        }, 'DEBUG: Withdrawal search result');
      }

      if (!payment && !transfer && !deposit && !withdrawal) {
        // Try to find preapproval
        preapproval = await prisma.preApproval.findFirst({
          where: {
            OR: [
              { preApprovalId: webhookData.data.externalId },
              { referenceId: referenceId }
            ]
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });
      }

      if (!payment && !transfer && !deposit && !withdrawal && !preapproval) {
        logger.warn({
          externalId: webhookData.data.externalId,
          referenceId
        }, 'Payment, transfer, deposit, withdrawal, or preapproval not found for MTN webhook');
        return reply.status(404).send({ error: 'Transaction not found' });
      }

      // 4. Update status based on MTN status (entity-specific mapping later for deposits)
      const newStatus = webhookData.data.status === 'SUCCESSFUL' ? 'COMPLETED' :
                       ['FAILED', 'REJECTED', 'APPROVAL_REJECTED', 'CANCELLED'].includes(webhookData.data.status) ? 'FAILED' : 'PENDING';

      const webhookFinId = webhookData.data.financialTransactionId;

      let userSettings = null;
      let transactionId = null;
      let transactionType = '';

      if (payment) {
        payment = await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: newStatus as any,
            financialTransactionId: webhookFinId || payment.financialTransactionId,
            metadata: {
              ...(payment.metadata as any || {}),
              mtnResponse: webhookData.data,
              lastWebhookAt: new Date().toISOString()
            },
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        }) as any;
        userSettings = (payment as any).apiKey?.user?.settings;
        transactionId = (payment as any).id;
        transactionType = 'payment';
      } else if (transfer) {
        transfer = await prisma.transfer.update({
          where: { id: transfer.id },
          data: {
            status: newStatus as any,
            financialTransactionId: webhookFinId || (transfer as any).financialTransactionId,
            metadata: {
              ...(transfer.metadata as any || {}),
              mtnResponse: webhookData.data,
              lastWebhookAt: new Date().toISOString()
            },
            completedAt: newStatus === 'COMPLETED' ? (transfer.completedAt || new Date()) : transfer.completedAt,
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });
        userSettings = transfer.apiKey?.user?.settings;
        transactionId = transfer.id;
        transactionType = 'transfer';
      } else if (deposit) {
        // Deposit model uses 'SUCCESSFUL' instead of 'COMPLETED'
        const depositStatus = newStatus === 'COMPLETED' ? 'SUCCESSFUL' : newStatus;
        deposit = await prisma.deposit.update({
          where: { id: deposit.id },
          data: {
            status: depositStatus as any,
            financialTransactionId: webhookFinId || (deposit as any).financialTransactionId,
            metadata: {
              ...(deposit.metadata as any || {}),
              mtnResponse: webhookData.data,
              lastWebhookAt: new Date().toISOString()
            },
            completedAt: depositStatus === 'SUCCESSFUL' ? (deposit.completedAt || new Date()) : deposit.completedAt,
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });
        userSettings = deposit.apiKey?.user?.settings;
        transactionId = deposit.id;
        transactionType = 'deposit';
      } else if (withdrawal) {
        logger.info({
          withdrawalId: withdrawal.withdrawId,
          withdrawalDbId: withdrawal.id,
          oldStatus: withdrawal.status,
          newStatus: newStatus,
          mtnStatus: webhookData.data.status,
          mtnData: webhookData.data
        }, 'DEBUG: Processing withdrawal webhook - updating status');

        withdrawal = await (prisma as any).withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: newStatus as any,
            financialTransactionId: webhookFinId || (withdrawal as any).financialTransactionId,
            metadata: {
              ...(withdrawal.metadata as any || {}),
              mtnResponse: webhookData.data,
              lastWebhookAt: new Date().toISOString()
            },
            rawStatusResponse: webhookData.data as any,
            completedAt: newStatus === 'COMPLETED' ? (withdrawal.completedAt || new Date()) : withdrawal.completedAt,
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });

        logger.info({
          withdrawalId: withdrawal.withdrawId,
          updatedStatus: withdrawal.status,
          completedAt: withdrawal.completedAt,
          hasWebhookUrl: !!withdrawal.apiKey?.user?.settings?.webhookUrl
        }, 'DEBUG: Withdrawal updated successfully');

        userSettings = withdrawal.apiKey?.user?.settings;
        transactionId = withdrawal.id;
        transactionType = 'withdrawal';
      } else if (preapproval) {
        // Map MTN status to PreApproval status
        let preapprovalStatus = 'PENDING';
        if (webhookData.data.status === 'SUCCESSFUL') {
          preapprovalStatus = 'APPROVED';
        } else if (webhookData.data.status === 'REJECTED' || webhookData.data.status === 'APPROVAL_REJECTED') {
          preapprovalStatus = 'REJECTED';
        } else if (webhookData.data.status === 'FAILED') {
          preapprovalStatus = 'FAILED';
        } else if (webhookData.data.status === 'CANCELLED') {
          preapprovalStatus = 'CANCELLED';
        }

        preapproval = await prisma.preApproval.update({
          where: { id: preapproval.id },
          data: {
            status: preapprovalStatus as any,
            metadata: {
              ...(preapproval.metadata as any || {}),
              mtnResponse: webhookData.data,
              lastWebhookAt: new Date().toISOString()
            },
            rawStatusResponse: webhookData.data as any,
            approvedAt: preapprovalStatus === 'APPROVED' ? new Date() : preapproval.approvedAt,
            cancelledAt: preapprovalStatus === 'CANCELLED' ? new Date() : preapproval.cancelledAt,
          },
          include: {
            apiKey: {
              include: {
                user: {
                  include: {
                    settings: true
                  }
                }
              }
            }
          }
        });
        userSettings = (preapproval as any).apiKey?.user?.settings;
        transactionId = preapproval.id;
        transactionType = 'preapproval';
      }

      // 5. Store incoming webhook
      const webhookData_delivery = {
        url: `${env.API_URL}${env.API_PREFIX}/webhooks/mtn`,
        status: 'DELIVERED',
        provider: 'MTN',
        providerSignature: signature,
        payload: payload as any,
        response: { status: 'processed' } as any,
        deliveredAt: new Date()
      };

      if (payment) {
        await prisma.webhookDelivery.create({
          data: { ...webhookData_delivery, paymentId: payment.id } as any
        });
      } else if (transfer) {
        await prisma.webhookDelivery.create({
          data: { ...webhookData_delivery, transferId: transfer.id } as any
        });
      } else if (deposit) {
        await prisma.webhookDelivery.create({
          data: { ...webhookData_delivery, depositId: deposit.id } as any
        });
      } else if (withdrawal) {
        logger.info({
          withdrawalId: withdrawal.withdrawId,
          withdrawalDbId: withdrawal.id,
          webhookDelivery: webhookData_delivery
        }, 'DEBUG: Creating withdrawal webhook delivery record');

        await prisma.webhookDelivery.create({
          data: { ...webhookData_delivery, withdrawalId: withdrawal.id } as any
        });

        logger.info({
          withdrawalId: withdrawal.withdrawId
        }, 'DEBUG: Withdrawal webhook delivery record created');
      } else if (preapproval) {
        await prisma.webhookDelivery.create({
          data: { ...webhookData_delivery, preapprovalId: preapproval.id } as any
        });
      }

      // 6. Forward to client webhook if configured
      if (userSettings?.webhookUrl) {
        const event = newStatus === 'COMPLETED' ? `${transactionType}.completed` :
                     newStatus === 'FAILED' ? `${transactionType}.failed` : `${transactionType}.updated`;

        if (userSettings?.webhookUrl && transactionId) {
          logger.info({
            transactionId,
            transactionType,
            event,
            webhookUrl: userSettings.webhookUrl
          }, 'DEBUG: Queueing merchant webhook for withdrawal');

          await WebhookService.queueWebhook(
            transactionId,
            event as any,
            userSettings.webhookUrl
          );

          logger.info({
            transactionId,
            transactionType,
            event
          }, 'DEBUG: Merchant webhook queued successfully');
        } else {
          logger.info({
            transactionId,
            transactionType,
            hasWebhookUrl: !!userSettings?.webhookUrl,
            hasTransactionId: !!transactionId
          }, 'DEBUG: Skipping merchant webhook - missing URL or transaction ID');
        }

        logger.info({
          transactionId,
          transactionType,
          event,
          webhookUrl: userSettings.webhookUrl
        }, 'Queued client webhook');
      }

      logger.info({
        transactionId,
        transactionType,
        newStatus,
        referenceId
      }, 'MTN webhook processed successfully');

      return { received: true, status: 'processed' };

    } catch (error) {
      logger.error({ error, payload }, 'Error processing MTN webhook');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Orange webhook endpoint (placeholder)
  app.post('/webhooks/orange', async (request) => {
    const payload = request.body;
    logger.info({ payload, provider: 'orange' }, 'Received Orange webhook');

    // TODO: Implement Orange webhook handling

    return { received: true };
  });

  // Generic provider webhook endpoint
  app.post('/webhooks/provider/:provider', async (request) => {
    const { provider } = request.params as { provider: string };
    const body = request.body;

    logger.info({ provider, body }, 'Received webhook from provider');

    // Route to specific provider handler
    if (provider === 'mtn') {
      return app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mtn',
        payload: body as any,
        headers: request.headers as any
      });
    } else if (provider === 'orange') {
      return app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/orange',
        payload: body as any,
        headers: request.headers as any
      });
    }

    return { received: true };
  });

  // Test webhook endpoint for development
  app.post('/webhooks/test', async (request, reply) => {
    if (env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Test endpoint disabled in production' });
    }

    const { paymentId, status, provider = 'mtn' } = request.body as any;

    // Simulate provider webhook
    const testPayload = {
      financialTransactionId: `test_${Date.now()}`,
      externalId: paymentId,
      amount: '10',
      currency: 'XAF',
      payer: {
        partyIdType: 'MSISDN',
        partyId: '237670000000'
      },
      status: status || 'SUCCESSFUL',
      reason: status === 'FAILED' ? 'Insufficient funds' : undefined
    };

    logger.info({ testPayload }, 'Sending test webhook');

    return app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${provider}`,
      payload: testPayload,
      headers: {
        'x-reference-id': `test_ref_${Date.now()}`
      }
    });
  });

  // Internal webhook for notifying merchants
  app.post('/webhooks/notify', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
    }

    try {
      const webhookData = webhookEventSchema.parse(request.body);

      // Get user settings for webhook URL
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: request.apiKey.id },
        include: {
          user: {
            include: {
              settings: true
            }
          }
        }
      });

      if (!apiKey?.user?.settings?.webhookUrl) {
        return reply.status(400).send({
          error: 'No webhook URL configured'
        });
      }

      // Queue webhook for delivery
      if (apiKey.user.settings?.webhookUrl && webhookData.paymentId) {
        await WebhookService.queueWebhook(
          webhookData.paymentId,
          webhookData.event,
          apiKey.user.settings.webhookUrl!
        );
      }

      logger.info({ webhookData }, 'Webhook notification queued');

      return {
        sent: true,
        webhookUrl: apiKey.user.settings.webhookUrl,
      };
    } catch (error) {
      logger.error({ error }, 'Error queuing webhook notification');
      throw error;
    }
  });

  // Configure webhook endpoint
  app.post('/webhooks/configure', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    try {
      const { url, events, secret } = request.body as {
        url: string;
        events?: string[];
        secret?: string;
      };

      // Get user from API key
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: request.apiKey.id },
        select: { userId: true },
      });

      if (!apiKey) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
      }

      // Validate webhook URL
      try {
        new URL(url);
      } catch (error) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid webhook URL format',
        });
      }

      // Update user settings with webhook configuration
      const settings = await prisma.userSettings.upsert({
        where: { userId: apiKey.userId },
        update: {
          webhookUrl: url,
          webhookSecret: secret || crypto.randomBytes(32).toString('hex'),
          webhookEvents: events || [
            'payment.created', 'payment.completed', 'payment.failed', 'payment.updated',
            'transfer.created', 'transfer.completed', 'transfer.failed', 'transfer.updated',
            'deposit.created', 'deposit.completed', 'deposit.failed', 'deposit.updated',
            'withdrawal.created', 'withdrawal.completed', 'withdrawal.failed', 'withdrawal.updated',
            'preapproval.created', 'preapproval.approved', 'preapproval.rejected', 'preapproval.expired', 'preapproval.cancelled', 'preapproval.failed'
          ],
        },
        create: {
          userId: apiKey.userId,
          webhookUrl: url,
          webhookSecret: secret || crypto.randomBytes(32).toString('hex'),
          webhookEvents: events || [
            'payment.created', 'payment.completed', 'payment.failed', 'payment.updated',
            'transfer.created', 'transfer.completed', 'transfer.failed', 'transfer.updated',
            'deposit.created', 'deposit.completed', 'deposit.failed', 'deposit.updated',
            'withdrawal.created', 'withdrawal.completed', 'withdrawal.failed', 'withdrawal.updated',
            'preapproval.created', 'preapproval.approved', 'preapproval.rejected', 'preapproval.expired', 'preapproval.cancelled', 'preapproval.failed'
          ],
          notificationEmail: '',
          enableEmail: true,
        },
      });

      logger.info({
        userId: apiKey.userId,
        webhookUrl: url,
        events: settings.webhookEvents
      }, 'Webhook configuration updated');

      return {
        message: 'Webhook configured successfully',
        url: settings.webhookUrl,
        events: settings.webhookEvents,
        secret: settings.webhookSecret,
      };
    } catch (error) {
      logger.error({ error }, 'Error configuring webhook');
      throw error;
    }
  });

  // Get webhook status endpoint
  app.get('/webhooks/status', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    try {
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: request.apiKey.id },
        include: {
          user: {
            include: {
              settings: {
                select: {
                  webhookUrl: true,
                  webhookEvents: true,
                }
              }
            }
          }
        }
      });

      if (!apiKey?.user?.settings?.webhookUrl) {
        return {
          configured: false,
          message: 'No webhook configured',
        };
      }

      return {
        configured: true,
        url: apiKey.user.settings.webhookUrl,
        events: apiKey.user.settings.webhookEvents,
      };
    } catch (error) {
      logger.error({ error }, 'Error getting webhook status');
      throw error;
    }
  });

  // Live webhook stream (SSE)
  app.get('/webhooks/stream', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'API key required' });
    }

    // Manually set CORS for SSE because we use raw headers
    const allowOrigin = process.env.CORS_ORIGIN || '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'X-API-Key, Authorization, Content-Type',
      'Vary': 'Origin',
    });

    const write = (event: any) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {}
    };

    // send a ping to keep-alive
    const ping = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch {}
    }, 15000);

    let lastTs = new Date(Date.now() - 60_000); // last minute

    const timer = setInterval(async () => {
      try {
        const apiKeyId = request.apiKey!.id;
        const deliveries = await prisma.webhookDelivery.findMany({
          where: {
            updatedAt: { gt: lastTs },
            OR: [
              { payment: { is: { apiKeyId } } },
              { transfer: { is: { apiKeyId } } },
              { deposit: { is: { apiKeyId } } },
              { withdrawal: { is: { apiKeyId } } },
              { preapproval: { is: { apiKeyId } } },
            ],
          },
          orderBy: { updatedAt: 'asc' },
          take: 50,
        });

        if (deliveries.length) {
          lastTs = deliveries[deliveries.length - 1].updatedAt;
          write({ type: 'deliveries', items: deliveries.map(d => {
            const payload: any = (d as any).payload || null;
            return {
              id: d.id,
              url: d.url,
              status: d.status,
              attempts: d.attempts,
              createdAt: d.createdAt,
              updatedAt: d.updatedAt,
              deliveredAt: d.deliveredAt,
              lastError: d.lastError,
              event: payload?.event || null,
              transactionId: payload?.transactionId || null,
              payloadStatus: payload?.status || null,
              entity: d.paymentId ? 'payment' : d.transferId ? 'transfer' : d.depositId ? 'deposit' : d.withdrawalId ? 'withdrawal' : d.preapprovalId ? 'preapproval' : 'unknown',
            };
          })});
        }
      } catch (e) {
        write({ type: 'error', message: (e as any)?.message || 'stream error' });
      }
    }, 1200);

    request.raw.on('close', () => {
      clearInterval(timer);
      clearInterval(ping);
    });
  });

  // Replay a specific webhook delivery
  app.post('/webhooks/deliveries/:id/replay', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'API key required' });
    }

    const { id } = request.params as { id: string };

    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id },
      include: {
        payment: { select: { apiKeyId: true } },
        transfer: { select: { apiKeyId: true } },
        deposit: { select: { apiKeyId: true } },
        withdrawal: { select: { apiKeyId: true } },
        preapproval: { select: { apiKeyId: true } },
      },
    });

    if (!delivery) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Delivery not found' });

    const ownerApiKeyId = delivery.payment?.apiKeyId || delivery.transfer?.apiKeyId || delivery.deposit?.apiKeyId || delivery.withdrawal?.apiKeyId || delivery.preapproval?.apiKeyId;
    if (ownerApiKeyId !== request.apiKey.id) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Not allowed' });
    }

    await prisma.webhookDelivery.update({ where: { id }, data: { status: 'PENDING', lastError: null } });
    await WebhookService.processWebhook(id);
    const refreshed = await prisma.webhookDelivery.findUnique({ where: { id } });
    return { ok: true, delivery: refreshed };
  });

  // List recent webhook deliveries for current API key (history)
  app.get('/webhooks/deliveries', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'API key required' });
    }

    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };
    const apiKeyId = request.apiKey.id;

    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        OR: [
          { payment: { is: { apiKeyId } } },
          { transfer: { is: { apiKeyId } } },
          { deposit: { is: { apiKeyId } } },
          { withdrawal: { is: { apiKeyId } } },
          { preapproval: { is: { apiKeyId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
    });

    return {
      items: deliveries.map((d) => {
        return {
          id: d.id,
          url: d.url,
          status: d.status,
          attempts: d.attempts,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          deliveredAt: d.deliveredAt,
          lastError: d.lastError,
          event: (d as any).payload?.event || null,
          transactionId: (d as any).payload?.transactionId || null,
          payloadStatus: (d as any).payload?.status || null,
          entity: d.paymentId
            ? 'payment'
            : d.transferId
            ? 'transfer'
            : d.depositId
            ? 'deposit'
            : d.withdrawalId
            ? 'withdrawal'
            : d.preapprovalId
            ? 'preapproval'
            : 'unknown',
        };
      }),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    };
  });

  // Get full details for a specific webhook delivery
  app.get('/webhooks/deliveries/:id', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'API key required' });
    }

    const { id } = request.params as { id: string };

    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id },
      include: {
        payment: { select: { apiKeyId: true, transactionId: true } },
        transfer: { select: { apiKeyId: true, transferId: true } },
        deposit: { select: { apiKeyId: true, depositId: true } },
        withdrawal: { select: { apiKeyId: true, withdrawId: true } as any },
        preapproval: { select: { apiKeyId: true, preApprovalId: true } },
      },
    });

    if (!delivery) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Delivery not found' });

    const ownerApiKeyId = delivery.payment?.apiKeyId || delivery.transfer?.apiKeyId || delivery.deposit?.apiKeyId || delivery.withdrawal?.apiKeyId || delivery.preapproval?.apiKeyId;
    if (ownerApiKeyId !== request.apiKey.id) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Not allowed' });
    }

    const entity = delivery.paymentId
      ? 'payment'
      : delivery.transferId
      ? 'transfer'
      : delivery.depositId
      ? 'deposit'
      : delivery.withdrawalId
      ? 'withdrawal'
      : delivery.preapprovalId
      ? 'preapproval'
      : 'unknown';

    const payload: any = (delivery as any).payload || null;
    return {
      id: delivery.id,
      url: delivery.url,
      status: delivery.status,
      attempts: delivery.attempts,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      deliveredAt: delivery.deliveredAt,
      lastError: delivery.lastError,
      providerSignature: delivery.providerSignature,
      response: delivery.response,
      payload,
      event: payload?.event || null,
      transactionId: payload?.transactionId || null,
      entity,
    };
  });
}
