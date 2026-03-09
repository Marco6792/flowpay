import { BaseError } from './base.error'

export class UnauthorizedError extends BaseError {
  constructor(message: string = 'Unauthorized', metadata: Record<string, any> = {}) {
    super(message, 401, 'UNAUTHORIZED', metadata)
  }
}
