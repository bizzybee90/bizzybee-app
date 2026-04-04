/**
 * Structured JSON logger for edge functions.
 * Includes correlation IDs for cross-function tracing.
 */

export function createLogger(functionName: string, correlationId?: string) {
  const corrId = correlationId ?? crypto.randomUUID().slice(0, 8);

  const log = (level: string, message: string, data?: Record<string, unknown>) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      function: functionName,
      correlationId: corrId,
      message,
      ...data,
    };
    // Deno structured logs go to stdout as JSON
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  };

  return {
    correlationId: corrId,
    debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
    error: (msg: string, error?: unknown, data?: Record<string, unknown>) => {
      const errorInfo =
        error instanceof Error
          ? { errorName: error.name, errorMessage: error.message }
          : error != null
            ? { errorRaw: String(error) }
            : {};
      log('error', msg, { ...errorInfo, ...data });
    },
  };
}
