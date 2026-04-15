import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import type { QueueRecord } from './types.ts';

export const DEFAULT_TIME_BUDGET_MS = 50_000;

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 30) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'RateLimitError';
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getOptionalEnv(name: string, fallback = ''): string {
  return Deno.env.get(name)?.trim() || fallback;
}

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL');
  const serviceRole = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-bb-component': 'pipeline' } },
  });
}

export function assertWorkerToken(req: Request): void {
  const expectedToken = getRequiredEnv('BB_WORKER_TOKEN');
  const providedToken = req.headers.get('x-bb-worker-token')?.trim();
  if (!providedToken || providedToken !== expectedToken) {
    throw new HttpError(401, 'Unauthorized worker token');
  }
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function triggerWorkerFunction(
  functionSlug: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL');
  const apiKey = getOptionalEnv('SUPABASE_SERVICE_ROLE_KEY') || getRequiredEnv('SUPABASE_ANON_KEY');
  const workerToken = getRequiredEnv('BB_WORKER_TOKEN');

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionSlug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'x-bb-worker-token': workerToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to trigger worker ${functionSlug} (${response.status}): ${errorText || 'unknown error'}`,
    );
  }
}

const WORKER_SECRET_NAMES: Record<string, string> = {
  'pipeline-worker-onboarding-discovery': 'bb_worker_onboarding_discovery_url',
  'pipeline-worker-onboarding-website': 'bb_worker_onboarding_website_url',
  'pipeline-worker-onboarding-faq': 'bb_worker_onboarding_faq_url',
  'pipeline-supervisor-onboarding': 'bb_worker_onboarding_supervisor_url',
  'pipeline-worker-import': 'bb_worker_import_url',
};

export async function wakeWorker(
  client: SupabaseClient,
  functionSlug: string,
  body: Record<string, unknown> = {},
): Promise<'pg_net' | 'direct' | 'pg_net+direct'> {
  const secretName = WORKER_SECRET_NAMES[functionSlug];
  let usedPgNet = false;

  if (secretName) {
    const { error } = await client.rpc('bb_trigger_worker', {
      p_url_secret_name: secretName,
      p_body: body,
    });

    if (!error) {
      usedPgNet = true;
    } else {
      console.warn('bb_trigger_worker failed', {
        functionSlug,
        error,
      });
    }
  }

  try {
    await triggerWorkerFunction(functionSlug, body);
    return usedPgNet ? 'pg_net+direct' : 'direct';
  } catch (error) {
    if (usedPgNet) {
      console.warn('Direct worker trigger failed after pg_net wake', {
        functionSlug,
        error,
      });
      return 'pg_net';
    }

    throw error;
  }
}

export function isUuidLike(value: string | null | undefined): boolean {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}

export function elapsedMs(startMs: number): number {
  return Date.now() - startMs;
}

export function withinBudget(startMs: number, budgetMs = DEFAULT_TIME_BUDGET_MS): boolean {
  return elapsedMs(startMs) < budgetMs;
}

export function calculateBackoffSeconds(
  attempt: number,
  baseSeconds = 5,
  maxSeconds = 300,
): number {
  const exp = Math.max(0, attempt - 1);
  const candidate = baseSeconds * 2 ** exp;
  const jitter = Math.floor(Math.random() * 4);
  return Math.min(maxSeconds, candidate + jitter);
}

export async function readQueue<T>(
  client: SupabaseClient,
  queueName: string,
  vtSeconds: number,
  n: number,
): Promise<Array<QueueRecord<T>>> {
  const { data, error } = await client.rpc('bb_queue_read', {
    queue_name: queueName,
    vt_seconds: vtSeconds,
    n,
  });

  if (error) {
    throw new Error(`Failed to read queue ${queueName}: ${error.message}`);
  }

  return (data || []) as Array<QueueRecord<T>>;
}

export async function queueDelete(
  client: SupabaseClient,
  queueName: string,
  msgId: number,
): Promise<void> {
  const { error } = await client.rpc('bb_queue_delete', {
    queue_name: queueName,
    msg_id: msgId,
  });

  if (error) {
    throw new Error(`Failed to delete queue message ${msgId} from ${queueName}: ${error.message}`);
  }
}

export async function queueArchive(
  client: SupabaseClient,
  queueName: string,
  msgId: number,
): Promise<void> {
  const { error } = await client.rpc('bb_queue_archive', {
    queue_name: queueName,
    msg_id: msgId,
  });

  if (error) {
    throw new Error(`Failed to archive queue message ${msgId} from ${queueName}: ${error.message}`);
  }
}

export async function queueSend(
  client: SupabaseClient,
  queueName: string,
  message: Record<string, unknown>,
  delaySeconds = 0,
): Promise<number> {
  const { data, error } = await client.rpc('bb_queue_send', {
    queue_name: queueName,
    message,
    delay_seconds: delaySeconds,
  });

  if (error) {
    throw new Error(`Failed to send queue message to ${queueName}: ${error.message}`);
  }

  return Number(data);
}

export async function queueSendBatch(
  client: SupabaseClient,
  queueName: string,
  messages: Array<Record<string, unknown>>,
  delaySeconds = 0,
): Promise<number[]> {
  const { data, error } = await client.rpc('bb_queue_send_batch', {
    queue_name: queueName,
    messages,
    delay_seconds: delaySeconds,
  });

  if (error) {
    throw new Error(`Failed to send queue batch to ${queueName}: ${error.message}`);
  }

  return (data as number[]) || [];
}

export async function touchPipelineRun(
  client: SupabaseClient,
  params: {
    runId?: string | null;
    metricsPatch?: Record<string, unknown>;
    state?: 'running' | 'paused' | 'failed' | 'completed';
    lastError?: string | null;
    markCompleted?: boolean;
  },
): Promise<void> {
  if (!params.runId) {
    return;
  }

  const { error } = await client.rpc('bb_touch_pipeline_run', {
    p_run_id: params.runId,
    p_metrics_patch: params.metricsPatch || {},
    p_state: params.state || null,
    p_last_error: params.lastError || null,
    p_mark_completed: params.markCompleted || false,
  });

  if (error) {
    throw new Error(`Failed to touch pipeline run ${params.runId}: ${error.message}`);
  }
}

export async function recordIncident(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    runId?: string | null;
    severity: 'info' | 'warning' | 'error' | 'critical';
    scope: string;
    error: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.rpc('bb_record_incident', {
    p_workspace_id: params.workspaceId,
    p_run_id: params.runId || null,
    p_severity: params.severity,
    p_scope: params.scope,
    p_error: params.error,
    p_context: params.context || {},
  });

  if (error) {
    throw new Error(`Failed to record incident: ${error.message}`);
  }
}

export async function auditJob(
  client: SupabaseClient,
  params: {
    workspaceId?: string | null;
    runId?: string | null;
    queueName: string;
    jobPayload: Record<string, unknown>;
    outcome: 'processed' | 'requeued' | 'deadlettered' | 'discarded' | 'failed';
    error?: string | null;
    attempts?: number;
  },
): Promise<void> {
  const payload = {
    workspace_id: params.workspaceId || null,
    run_id: params.runId || null,
    queue_name: params.queueName,
    job_payload: params.jobPayload,
    outcome: params.outcome,
    error: params.error || null,
    attempts: params.attempts || 0,
  };

  const { error } = await client.from('pipeline_job_audit').insert(payload);
  if (error) {
    console.error('pipeline_job_audit insert failed', error.message, payload);
  }
}

export async function deadletterJob(
  client: SupabaseClient,
  params: {
    fromQueue: string;
    msgId: number;
    attempts: number;
    workspaceId?: string | null;
    runId?: string | null;
    jobPayload: Record<string, unknown>;
    error: string;
    scope: string;
  },
): Promise<void> {
  const deadletterPayload = {
    ...params.jobPayload,
    deadlettered_from: params.fromQueue,
    deadlettered_msg_id: params.msgId,
    deadlettered_attempts: params.attempts,
    deadlettered_error: params.error,
    deadlettered_at: nowIso(),
  };

  await queueSend(client, 'bb_deadletter_jobs', deadletterPayload, 0);
  await queueArchive(client, params.fromQueue, params.msgId);

  if (params.workspaceId) {
    await recordIncident(client, {
      workspaceId: params.workspaceId,
      runId: params.runId,
      severity: 'error',
      scope: params.scope,
      error: params.error,
      context: {
        from_queue: params.fromQueue,
        msg_id: params.msgId,
        attempts: params.attempts,
        job: params.jobPayload,
      },
    });
  }

  await auditJob(client, {
    workspaceId: params.workspaceId,
    runId: params.runId,
    queueName: params.fromQueue,
    jobPayload: params.jobPayload,
    outcome: 'deadlettered',
    error: params.error,
    attempts: params.attempts,
  });
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseRetryAfterSeconds(response: Response, fallback = 30): number {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) {
    return fallback;
  }

  const asNumber = Number(retryAfter);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.floor(asNumber);
  }

  const asDate = Date.parse(retryAfter);
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1000);
    return diff > 0 ? diff : fallback;
  }

  return fallback;
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractJsonFromText(value: string): unknown {
  const direct = safeJsonParse(value);
  if (direct) {
    return direct;
  }

  const fenced = value.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return safeJsonParse(fenced[1]);
  }

  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return safeJsonParse(value.slice(firstBrace, lastBrace + 1));
  }

  return null;
}
