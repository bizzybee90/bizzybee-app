import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  createServiceClient,
  getOptionalEnv,
  getRequiredEnv,
  HttpError,
  isUuidLike,
  jsonResponse,
  queueSend,
  touchPipelineRun,
  wakeWorker,
} from '../_shared/pipeline.ts';

interface StartImportPayload {
  workspace_id?: string;
  config_id?: string;
  mode?: 'onboarding' | 'backfill';
  cap?: number;
}

type PipelineRunRow = {
  id: string;
  workspace_id: string;
  config_id: string;
  state: string;
  created_at?: string | null;
  last_error?: string | null;
  params?: {
    cap?: number;
  } | null;
  metrics?: {
    fetched_so_far?: number;
    pages?: number;
    rate_limit_count?: number;
    last_folder?: 'SENT' | 'INBOX';
    last_page_token?: string | null;
  } | null;
};

const STALE_IMPORT_RUN_MS = 2 * 60 * 1000;

function isMailboxWarmupDeadlock(lastError: string | null | undefined): boolean {
  const normalized = String(lastError || '').toLowerCase();
  return normalized.includes('mailbox_warmup_stuck') || normalized.includes('mailbox_warmup_retry');
}

function shouldReplaceExistingRun(run: PipelineRunRow): boolean {
  const fetchedSoFar = Math.max(0, Math.floor(Number(run.metrics?.fetched_so_far || 0)));
  const createdAtMs = run.created_at ? new Date(run.created_at).getTime() : 0;
  const ageMs = createdAtMs ? Date.now() - createdAtMs : 0;

  return (
    fetchedSoFar === 0 && ageMs >= STALE_IMPORT_RUN_MS && isMailboxWarmupDeadlock(run.last_error)
  );
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function queueImportResumeJob(
  supabase: ReturnType<typeof createServiceClient>,
  run: PipelineRunRow,
) {
  const cap = Math.max(1, Math.min(10000, Math.floor(Number(run.params?.cap || 2500))));
  const fetchedSoFar = Math.max(0, Math.floor(Number(run.metrics?.fetched_so_far || 0)));
  const pages = Math.max(0, Math.floor(Number(run.metrics?.pages || 0)));
  const rateLimitCount = Math.max(0, Math.floor(Number(run.metrics?.rate_limit_count || 0)));
  const folder = run.metrics?.last_folder === 'INBOX' ? 'INBOX' : 'SENT';
  const pageToken =
    typeof run.metrics?.last_page_token === 'string' && run.metrics.last_page_token.length > 0
      ? run.metrics.last_page_token
      : null;

  await queueSend(
    supabase,
    'bb_import_jobs',
    {
      job_type: 'IMPORT_FETCH',
      workspace_id: run.workspace_id,
      run_id: run.id,
      config_id: run.config_id,
      folder,
      pageToken,
      cap,
      fetched_so_far: fetchedSoFar,
      pages,
      rate_limit_count: rateLimitCount,
    },
    0,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const body = (await req.json()) as StartImportPayload;
    const workspaceId = body.workspace_id?.trim();
    const configId = body.config_id?.trim();
    const mode = body.mode || 'onboarding';

    if (!workspaceId || !isUuidLike(workspaceId)) {
      throw new HttpError(400, 'workspace_id must be a UUID');
    }

    if (!configId || !isUuidLike(configId)) {
      throw new HttpError(400, 'config_id must be a UUID');
    }

    if (!['onboarding', 'backfill'].includes(mode)) {
      throw new HttpError(400, 'mode must be onboarding or backfill');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new HttpError(401, 'Authorization header is required');
    }

    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const anonKey = getRequiredEnv('SUPABASE_ANON_KEY');
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      throw new HttpError(401, 'Invalid auth token');
    }

    const { data: canAccess, error: accessError } = await userClient.rpc('bb_user_in_workspace', {
      p_workspace_id: workspaceId,
    });
    if (accessError) {
      throw new Error(`Workspace access check failed: ${accessError.message}`);
    }
    if (!canAccess) {
      throw new HttpError(403, 'Not allowed to start pipeline run for this workspace');
    }

    // Double-import prevention: check for existing running pipeline_run
    const supabase = createServiceClient();
    const { data: existingRun, error: existingRunError } = await supabase
      .from('pipeline_runs')
      .select('id, workspace_id, config_id, state, params, metrics, created_at, last_error')
      .eq('workspace_id', workspaceId)
      .eq('config_id', configId)
      .eq('state', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRunError) {
      console.warn('Failed to check for existing run:', existingRunError.message);
    }

    if (existingRun && shouldReplaceExistingRun(existingRun as PipelineRunRow)) {
      await touchPipelineRun(supabase, {
        runId: existingRun.id,
        state: 'failed',
        lastError:
          'MAILBOX_WARMUP_STUCK: Previous import run stalled before any email could be imported. BizzyBee is starting a fresh import run now.',
      });
    } else if (existingRun) {
      await queueImportResumeJob(supabase, existingRun as PipelineRunRow);
      try {
        await wakeWorker(supabase, 'pipeline-worker-import');
      } catch (workerKickError) {
        console.warn('Failed to wake existing import worker:', workerKickError);
      }

      return corsResponse({
        ok: true,
        already_running: true,
        run_id: existingRun.id,
        existing_run_state: existingRun.state,
      });
    }

    const defaultCap = mode === 'onboarding' ? 2500 : 5000;
    const maxCap = Number(getOptionalEnv('BB_IMPORT_CAP_MAX', '10000'));
    const requestedCap = Number.isFinite(body.cap) ? Math.floor(Number(body.cap)) : defaultCap;
    const cap = Math.max(1, Math.min(maxCap, requestedCap));

    const runInsert = {
      workspace_id: workspaceId,
      config_id: configId,
      channel: 'email',
      mode,
      state: 'running',
      params: {
        cap,
        folder_order: ['SENT', 'INBOX'],
        speed_phase: mode === 'onboarding' ? 'fast' : 'steady',
      },
      metrics: {
        fetched_so_far: 0,
        pages: 0,
        rate_limit_count: 0,
        import_done: false,
      },
    };

    const { data: run, error: runError } = await supabase
      .from('pipeline_runs')
      .insert(runInsert)
      .select('id')
      .single();

    if (runError || !run?.id) {
      throw new Error(`Failed to create pipeline run: ${runError?.message || 'unknown'}`);
    }

    await queueSend(
      supabase,
      'bb_import_jobs',
      {
        job_type: 'IMPORT_FETCH',
        workspace_id: workspaceId,
        run_id: run.id,
        config_id: configId,
        folder: 'SENT',
        pageToken: null,
        cap,
        fetched_so_far: 0,
        pages: 0,
        rate_limit_count: 0,
      },
      0,
    );

    try {
      await wakeWorker(supabase, 'pipeline-worker-import');
    } catch (workerKickError) {
      console.warn('Failed to wake import worker immediately:', workerKickError);
    }

    return corsResponse({ ok: true, run_id: run.id, cap, mode });
  } catch (error) {
    console.error('start-email-import error', error);
    if (error instanceof HttpError) {
      return corsResponse({ ok: false, error: error.message }, error.status);
    }

    return corsResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
    );
  }
});
