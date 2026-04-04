/**
 * Structured logger for BizzyBee.
 * - In production: only info, warn, error are emitted
 * - In development: debug is also emitted
 * - All methods accept structured data as a second argument
 */

const isDev = import.meta.env.DEV;

type LogData = Record<string, unknown>;

function formatMessage(level: string, message: string, data?: LogData): string {
  if (data && Object.keys(data).length > 0) {
    return `[${level}] ${message} ${JSON.stringify(data)}`;
  }
  return `[${level}] ${message}`;
}

export const logger = {
  /** Debug-level logs — stripped in production */
  debug(message: string, data?: LogData): void {
    if (isDev) {
      console.debug(formatMessage('DEBUG', message, data));
    }
  },

  /** Informational logs */
  info(message: string, data?: LogData): void {
    console.info(formatMessage('INFO', message, data));
  },

  /** Warning logs */
  warn(message: string, data?: LogData): void {
    console.warn(formatMessage('WARN', message, data));
  },

  /** Error logs — always emitted */
  error(message: string, error?: unknown, data?: LogData): void {
    const errorInfo =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error != null
          ? { raw: String(error) }
          : undefined;

    console.error(formatMessage('ERROR', message, { ...data, ...errorInfo }));
  },
};
