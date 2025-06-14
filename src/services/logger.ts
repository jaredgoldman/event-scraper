import pino from 'pino'
import { env } from '../config/env'
import { DateTime } from 'luxon'

const pinoLogger = pino(
  {
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    level: env.DEBUG_LEVEL,
  },
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
    },
  })
)

/**
 * Logger class for logging
 * @class
 */
class LoggerService {
  public static info(message: string, obj?: any): void {
    obj ? pinoLogger.info(obj, message) : pinoLogger.info(message)
  }
  public static warn(message: string, obj?: any): void {
    obj ? pinoLogger.warn(obj, message) : pinoLogger.warn(message)
  }
  public static debug(message: string, obj?: any): void {
    obj ? pinoLogger.debug(obj, message) : pinoLogger.debug(message)
  }
  public static error(message: string, obj?: any): void {
    obj ? pinoLogger.error(obj, message) : pinoLogger.error(message)
  }
}

export const logger = LoggerService

export const initLog = () => {
  const currentDate = DateTime.now()
  LoggerService.info(`
====================================================
Event Scraper now online
----------------------------------------------------
Boot time:                ${process.uptime()}s
Current Time (ISO):       ${currentDate.toFormat('yyyy-MM-dd HH:mm:ss')}
AI Provider:              ${env.AI_PROVIDER || 'MULTI_PROVIDER'}
Debug Level               ${env.DEBUG_LEVEL}
====================================================
`)
}
