import { FastifyInstance } from 'fastify';
import { BalanceController } from '../controllers/balance.controller.ts';

const balanceController = new BalanceController();

export async function balanceRoutes(app: FastifyInstance): Promise<void> {
  // All balance routes need auth (middleware runs globally)
  
  /**
   * Get aggregated balances across all providers and local wallets
   */
  app.get('/balance/aggregated', {
    schema: {
      description: 'Get aggregated balances across all providers and local wallets',
      tags: ['Balance'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                balances: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      currency: { type: 'string' },
                      localWalletBalance: { type: 'number' },
                      providerBalances: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            provider: { type: 'string' },
                            availableBalance: { type: 'number' },
                            accountStatus: { type: 'string' },
                            success: { type: 'boolean' }
                          }
                        }
                      },
                      totalBalance: { type: 'number' },
                      lastUpdated: { type: 'string' }
                    }
                  }
                },
                summary: {
                  type: 'object',
                  properties: {
                    localWalletTotal: { type: 'number' },
                    providerBalanceTotal: { type: 'number' },
                    grandTotal: { type: 'number' }
                  }
                },
                timestamp: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, (request, reply) => balanceController.getAggregatedBalance(request, reply));

  /**
   * Get local wallet balances only
   */
  app.get('/balance/wallets', {
    schema: {
      description: 'Get local wallet balances only',
      tags: ['Balance'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                wallets: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      provider: { type: 'string' },
                      balance: { type: 'number' },
                      currency: { type: 'string' },
                      status: { type: 'string' }
                    }
                  }
                },
                totalBalance: { type: 'number' },
                timestamp: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, (request, reply) => balanceController.getWalletBalances(request, reply));

  /**
   * Get provider balances only
   */
  app.get('/balance/providers', {
    schema: {
      description: 'Get balances from all payment providers',
      tags: ['Balance'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                providers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      success: { type: 'boolean' },
                      balances: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            currency: { type: 'string' },
                            availableBalance: { type: 'number' },
                            accountStatus: { type: 'string' }
                          }
                        }
                      }
                    }
                  }
                },
                timestamp: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, (request, reply) => balanceController.getProviderBalances(request, reply));

  /**
   * Get balance for specific provider
   */
  app.get('/balance/provider/:provider', {
    schema: {
      description: 'Get balance for specific provider (MTN or Orange)',
      tags: ['Balance'],
      params: {
        type: 'object',
        properties: {
          provider: { 
            type: 'string',
            enum: ['mtn', 'orange', 'MTN', 'ORANGE'],
            description: 'Provider name (case insensitive)'
          }
        },
        required: ['provider']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                localWalletBalance: { type: 'number' },
                providerBalance: { type: 'number' },
                providerStatus: { type: 'string' },
                totalBalance: { type: 'number' },
                timestamp: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, (request, reply) => balanceController.getProviderBalance(request, reply));

  /**
   * Refresh balance cache
   */
  app.post('/balance/refresh', {
    schema: {
      description: 'Refresh balance cache and get updated aggregated balances',
      tags: ['Balance'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                refreshed: { type: 'boolean' },
                refreshedAt: { type: 'string' },
                balances: {
                  type: 'array',
                  description: 'Updated balance data after refresh'
                },
                summary: {
                  type: 'object',
                  properties: {
                    localWalletTotal: { type: 'number' },
                    providerBalanceTotal: { type: 'number' },
                    grandTotal: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, (request, reply) => balanceController.refreshBalance(request, reply));

  /**
   * Get wallet transaction history
   */
  app.get('/balance/transactions', {
    schema: {
      description: 'Get wallet transaction history with optional filtering',
      tags: ['Balance'],
      querystring: {
        type: 'object',
        properties: {
          provider: { 
            type: 'string',
            enum: ['MTN', 'ORANGE'],
            description: 'Filter by specific provider'
          },
          limit: { 
            type: 'string',
            pattern: '^[0-9]+$',
            description: 'Maximum number of transactions to return (default: 50)'
          },
          offset: { 
            type: 'string',
            pattern: '^[0-9]+$',
            description: 'Number of transactions to skip (default: 0)'
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                transactions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string' },
                      amount: { type: 'number' },
                      balanceBefore: { type: 'number' },
                      balanceAfter: { type: 'number' },
                      reference: { type: 'string' },
                      description: { type: 'string' },
                      metadata: { type: 'object' },
                      createdAt: { type: 'string' }
                    }
                  }
                },
                pagination: {
                  type: 'object',
                  properties: {
                    limit: { type: 'number' },
                    offset: { type: 'number' },
                    count: { type: 'number' },
                    hasMore: { type: 'boolean' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, (request, reply) => balanceController.getTransactionHistory(request, reply));
}