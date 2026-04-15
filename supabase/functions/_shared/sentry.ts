import * as Sentry from 'npm:@sentry/deno@10.48.0';

const EDGE_DSN_ENV = 'SENTRY_EDGE_DSN';
const EDGE_ENV_ENV = 'SENTRY_EDGE_ENVIRONMENT';
const FLUSH_TIMEOUT_MS = 2000;

let initialized = false;
let enabled = false;

function getEnvironment(): string {
  return (
    Deno.env.get(EDGE_ENV_ENV)?.trim() ||
    Deno.env.get('SUPABASE_ENV')?.trim() ||
    (Deno.env.get('DENO_DEPLOYMENT_ID') ? 'production' : 'development')
  );
}

function ensureInit(): boolean {
  if (initialized) {
    return enabled;
  }

  initialized = true;
  const dsn = Deno.env.get(EDGE_DSN_ENV)?.trim();
  if (!dsn) {
    enabled = false;
    return false;
  }

  Sentry.init({
    dsn,
    environment: getEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  enabled = true;
  return true;
}

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable };

type EdgeCaptureParams = {
  functionName: string;
  error: unknown;
  tags?: Record<string, string | number | boolean>;
  extra?: Record<string, Serializable>;
};

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

export async function captureEdgeException(params: EdgeCaptureParams): Promise<string | undefined> {
  if (!ensureInit()) {
    return undefined;
  }

  const error = normalizeError(params.error);
  const eventId = Sentry.withScope((scope) => {
    scope.setTag('component', 'supabase-edge');
    scope.setTag('function', params.functionName);

    for (const [key, value] of Object.entries(params.tags ?? {})) {
      scope.setTag(key, String(value));
    }

    for (const [key, value] of Object.entries(params.extra ?? {})) {
      scope.setExtra(key, value);
    }

    return Sentry.captureException(error);
  });

  await Sentry.flush(FLUSH_TIMEOUT_MS);
  return eventId;
}
