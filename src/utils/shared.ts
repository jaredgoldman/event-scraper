import { logger } from '../services'
import { DateTime } from 'luxon'

/**
 * A retry configuration object
 * @interface
 * @property {number} maxRetries - The maximum number of retries
 * @property {number} retryDelay - The delay between retries in milliseconds
 * @property {number} circuitBreakerThreshold - The threshold for the circuit breaker
 * @property {number} circuitBreakerTimeout - The timeout for the circuit breaker in milliseconds
 * @property {boolean} circuitOpen - Whether the circuit breaker is open
 * @property {number} lastFailureTime - The timestamp of the last failure
 * @property {number} failureCount - The number of failures
 */
interface RetryConfig {
  maxRetries: number
  retryDelay: number
  circuitBreakerThreshold: number
  circuitBreakerTimeout: number
  circuitOpen: boolean
  lastFailureTime: number
  failureCount: number
}

/**
 * Get the default retry configuration
 */
function getDefaultRetryConfig(): RetryConfig {
  return {
    maxRetries: 3,
    retryDelay: 1000,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000,
    circuitOpen: false,
    lastFailureTime: 0,
    failureCount: 0,
  }
}

/**
 * Execute a function with retry logic and circuit breaker
 * @param {Function} fn - The function to execute
 * @param {string} operation - The name of the operation for logging
 * @returns {Promise<T>} - The result of the function
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  config?: RetryConfig
): Promise<T> {
  if (!config) {
    config = getDefaultRetryConfig()
  }
  if (config.circuitOpen) {
    const now = Date.now()
    if (now - config.lastFailureTime < config.circuitBreakerTimeout) {
      throw new Error(`Circuit breaker is open for ${operation}`)
    }
    config.circuitOpen = false
    config.failureCount = 0
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn()
      config.failureCount = 0
      return result
    } catch (error) {
      lastError = error
      config.failureCount++
      config.lastFailureTime = Date.now()

      if (config.failureCount >= config.circuitBreakerThreshold) {
        config.circuitOpen = true
        logger.error(
          `Circuit breaker opened for ${operation} after ${config.failureCount} failures`
        )
        throw new Error(`Circuit breaker opened for ${operation}`)
      }

      const delay = config.retryDelay * Math.pow(2, attempt - 1)
      logger.warn(
        `Attempt ${attempt}/${config.maxRetries} failed for ${operation}, retrying in ${delay}ms`,
        error
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Convert a date string to ISO format in Toronto timezone
 * @param {string} dateStr - The date string to convert
 * @returns {string} - The date in ISO format
 */
export function convertToTimeZone(
  dateStr: string,
  timezone = 'America/Toronto'
): string {
  try {
    // First try to parse as ISO
    let dt = DateTime.fromISO(dateStr, { zone: timezone })

    // If that fails, try common time formats in Toronto timezone
    if (!dt.isValid) {
      const formats = [
        'yyyy-MM-dd HH:mm',
        'yyyy-MM-dd h:mm a',
        'yyyy-MM-dd h:mma',
        'yyyy-MM-dd hh:mm a',
        'yyyy-MM-dd hh:mma',
        'MM/dd/yyyy HH:mm',
        'MM/dd/yyyy h:mm a',
        'MM/dd/yyyy h:mma',
        'MM/dd/yyyy hh:mm a',
        'MM/dd/yyyy hh:mma',
        'MMMM d, yyyy HH:mm',
        'MMMM d, yyyy h:mm a',
        'MMMM d, yyyy h:mma',
        'MMMM d, yyyy hh:mm a',
        'MMMM d, yyyy hh:mma',
        'd MMMM yyyy HH:mm',
        'd MMMM yyyy h:mm a',
        'd MMMM yyyy h:mma',
        'd MMMM yyyy hh:mm a',
        'd MMMM yyyy hh:mma',
        'MMM d, yyyy HH:mm',
        'MMM d, yyyy h:mm a',
        'MMM d, yyyy h:mma',
        'MMM d, yyyy hh:mm a',
        'MMM d, yyyy hh:mma',
        'd MMM yyyy HH:mm',
        'd MMM yyyy h:mm a',
        'd MMM yyyy h:mma',
        'd MMM yyyy hh:mm a',
        'd MMM yyyy hh:mma',
      ]

      for (const format of formats) {
        dt = DateTime.fromFormat(dateStr, format, { zone: timezone })
        if (dt.isValid) break
      }
    }

    // If still invalid, try to parse as just date and assume evening time (7 PM)
    if (!dt.isValid) {
      dt = DateTime.fromFormat(dateStr, 'yyyy-MM-dd', {
        zone: timezone,
      }).set({ hour: 19, minute: 0, second: 0, millisecond: 0 })
    }

    // If we have a valid date, ensure it's in Toronto timezone
    if (dt.isValid) {
      // Force conversion to Toronto timezone and ensure UTC offset is correct
      dt = dt.setZone(timezone, { keepLocalTime: false })

      // Validate date is within acceptable range
      // const now = DateTime.now().setZone(timezone);
      // const minDate = now.minus({ days: this.minPastDays });
      // const maxDate = now.plus({ days: this.maxFutureDays });

      // if (dt < minDate) {
      //   logger.warn(`Date ${dt.toISO()} is too far in the past`);
      //   throw new Error(`Date ${dt.toISO()} is too far in the past`);
      // }

      // if (dt > maxDate) {
      //   logger.warn(`Date ${dt.toISO()} is too far in the future`);
      //   throw new Error(`Date ${dt.toISO()} is too far in the future`);
      // }

      return dt.toISO() as string
    }

    throw new Error(`Invalid date format: ${dateStr}`)
  } catch (error) {
    logger.error(`Error converting date ${dateStr} to Toronto time:`, error)
    throw error
  }
}

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))
