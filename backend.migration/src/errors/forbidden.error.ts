import { BaseError } from './base.error'

export class ForbiddenError extends BaseError {
  constructor(message: string = 'Forbidden', metadata: Record<string, any> = {}) {
    super(message, 403, 'FORBIDDEN', metadata)
  }
}
