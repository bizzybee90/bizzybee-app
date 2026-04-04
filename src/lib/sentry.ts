import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Only send errors in production
    enabled: import.meta.env.PROD,
    // Sample 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
    // Don't send PII
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip any potential PII from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((bc) => ({
          ...bc,
          data: undefined,
        }));
      }
      return event;
    },
  });
}

export { Sentry };
