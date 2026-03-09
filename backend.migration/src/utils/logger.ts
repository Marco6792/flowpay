/**
 * Console-based logger for services and utilities that don't have access to Motia's ctx.logger.
 *
 * Step handlers and middleware should use ctx.logger instead of this module.
 * This exists only for service-layer code that runs outside of Motia context.
 *
 * Matches pino's API surface so services don't need refactoring.
 */

type LogData = Record<string, unknown>

function formatMsg(data: LogData | string, msg?: string): string {
  if (typeof data === 'string') return data
  const prefix = msg ? `${msg} ` : ''
  return `${prefix}${JSON.stringify(data)}`
}

export const logger = {
  info(data: LogData | string, msg?: string) {
    console.log(`[INFO] ${formatMsg(data, msg)}`)
  },
  warn(data: LogData | string, msg?: string) {
    console.warn(`[WARN] ${formatMsg(data, msg)}`)
  },
  error(data: LogData | string, msg?: string) {
    console.error(`[ERROR] ${formatMsg(data, msg)}`)
  },
  debug(data: LogData | string, msg?: string) {
    if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
      console.debug(`[DEBUG] ${formatMsg(data, msg)}`)
    }
  },
  fatal(data: LogData | string, msg?: string) {
    console.error(`[FATAL] ${formatMsg(data, msg)}`)
  },
  trace(data: LogData | string, msg?: string) {
    if (process.env.LOG_LEVEL === 'trace') {
      console.trace(`[TRACE] ${formatMsg(data, msg)}`)
    }
  },
}
