import { createServiceClient, HttpError, queueSend, wakeWorker } from '../_shared/pipeline.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  ONBOARDING_DISCOVERY_QUEUE,
  ONBOARDING_FAQ_QUEUE,
  ONBOARDING_WEBSITE_QUEUE,
} from '../_shared/onboarding.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type WorkflowKey =
  | 'competitor_discovery'
  | 'faq_generation'
  | 'email_import'
  | 'own_website_scrape';

type RunRow = {
  id: string;
  workspace_id: string;
  status: string;
  current_step_key: string | null;
  source_job_id?: string | null;
  input_snapshot?: Record<string, unknown> | null;
};

type ImportRunRow = {
  id: string;
  workspace_id: string;
  config_id: string;
  state: string;
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

function corsResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function hasRunArtifact(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  workspaceId: string,
  artifactKey: string,
) {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('id')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', artifactKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, `Failed to inspect artifact ${artifactKey}: ${error.message}`);
  }

  return Boolean(data?.id);
}

async function loadLatestRun(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  workflowKey: 'competitor_discovery' | 'faq_generation' | 'own_website_scrape',
  requestedRunId?: string | null,
) {
  let query = supabase
    .from('agent_runs')
    .select('id, workspace_id, status, current_step_key, source_job_id, input_snapshot')
    .eq('workspace_id', workspaceId)
    .eq('workflow_key', workflowKey)
    .order('created_at', { ascending: false })
    .limit(1);

  if (requestedRunId) {
    query = query.eq('id', requestedRunId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new HttpError(500, `Failed to load ${workflowKey} run: ${error.message}`);
  }

  return (data as RunRow | null) ?? null;
}

function resolveDiscoverySourceJobId(run: RunRow): string | null {
  if (typeof run.source_job_id === 'string' && run.source_job_id.trim().length > 0) {
    return run.source_job_id;
  }

  const fromSnapshot = run.input_snapshot?.competitor_research_job_id;
  return typeof fromSnapshot === 'string' && fromSnapshot.trim().length > 0 ? fromSnapshot : null;
}

async function resolvePendingDiscoveryStep(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
) {
  const hasQualifiedCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'qualified_candidates',
  );

  if (hasQualifiedCandidates) {
    const sourceJobId = resolveDiscoverySourceJobId(run);
    if (!sourceJobId) return null;

    const { count, error } = await supabase
      .from('competitor_sites')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', run.workspace_id)
      .eq('job_id', sourceJobId);

    if (error) {
      throw new HttpError(500, `Failed to inspect competitor rows: ${error.message}`);
    }

    return (count || 0) > 0 ? null : 'persist';
  }

  const hasAcquiredCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'acquired_candidates',
  );

  return hasAcquiredCandidates ? 'qualify' : 'acquire';
}

async function resolvePendingFaqStep(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
) {
  const hasContext = await hasRunArtifact(supabase, run.id, run.workspace_id, 'faq_context');
  if (!hasContext) return 'load_context';

  const hasPages = await hasRunArtifact(supabase, run.id, run.workspace_id, 'faq_pages');
  if (!hasPages) return 'fetch_pages';

  const hasRawCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'faq_candidates_raw',
  );
  if (!hasRawCandidates) return 'generate_candidates';

  const hasDedupedCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'faq_candidates_deduped',
  );
  if (!hasDedupedCandidates) return 'dedupe';

  const hasFinalCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'faq_candidates_final',
  );
  if (!hasFinalCandidates) return 'finalize';

  const { count, error } = await supabase
    .from('faq_database')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', run.workspace_id)
    .eq('is_own_content', false);

  if (error) {
    throw new HttpError(500, `Failed to inspect competitor FAQ rows: ${error.message}`);
  }

  return (count || 0) > 0 ? null : 'persist';
}

async function resolvePendingWebsiteStep(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
) {
  const hasPages = await hasRunArtifact(supabase, run.id, run.workspace_id, 'website_pages');
  if (!hasPages) return 'fetch';

  const hasCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'website_faq_candidates',
  );
  if (!hasCandidates) return 'extract';

  const { count, error } = await supabase
    .from('faq_database')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', run.workspace_id)
    .eq('is_own_content', true);

  if (error) {
    throw new HttpError(500, `Failed to inspect website FAQ rows: ${error.message}`);
  }

  return (count || 0) > 0 ? null : 'persist';
}

function buildImportResumeJob(run: ImportRunRow) {
  return {
    job_type: 'IMPORT_FETCH',
    workspace_id: run.workspace_id,
    run_id: run.id,
    config_id: run.config_id,
    folder: run.metrics?.last_folder === 'INBOX' ? 'INBOX' : 'SENT',
    pageToken:
      typeof run.metrics?.last_page_token === 'string' && run.metrics.last_page_token.length > 0
        ? run.metrics.last_page_token
        : null,
    cap: Math.max(1, Math.min(10000, Math.floor(Number(run.params?.cap || 2500)))),
    fetched_so_far: Math.max(0, Math.floor(Number(run.metrics?.fetched_so_far || 0))),
    pages: Math.max(0, Math.floor(Number(run.metrics?.pages || 0))),
    rate_limit_count: Math.max(0, Math.floor(Number(run.metrics?.rate_limit_count || 0))),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const body = (await req.json()) as {
      workspace_id?: string;
      run_id?: string | null;
      workflow_key?: WorkflowKey;
    };

    const workspaceId = body.workspace_id?.trim();
    if (!workspaceId) {
      throw new HttpError(400, 'workspace_id is required');
    }

    try {
      await validateAuth(req, workspaceId);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }

    const workflowKey = body.workflow_key?.trim() as WorkflowKey | undefined;
    const requestedRunId = body.run_id?.trim() || null;
    const supabase = createServiceClient();

    if (workflowKey === 'competitor_discovery') {
      const run = await loadLatestRun(
        supabase,
        workspaceId,
        'competitor_discovery',
        requestedRunId,
      );
      if (!run) {
        return corsResponse({ ok: true, nudged: false, status: 'idle' });
      }

      const nextStep = await resolvePendingDiscoveryStep(supabase, run);
      if (nextStep) {
        await queueSend(
          supabase,
          ONBOARDING_DISCOVERY_QUEUE,
          {
            run_id: run.id,
            workspace_id: run.workspace_id,
            step: nextStep,
            attempt: 1,
          },
          0,
        );
      }

      await wakeWorker(supabase, 'pipeline-worker-onboarding-discovery');

      return corsResponse({
        ok: true,
        nudged: true,
        run_id: run.id,
        status: run.status,
        current_step: run.current_step_key,
        next_step: nextStep ?? run.current_step_key,
      });
    }

    if (workflowKey === 'faq_generation') {
      const run = await loadLatestRun(supabase, workspaceId, 'faq_generation', requestedRunId);
      if (!run) {
        return corsResponse({ ok: true, nudged: false, status: 'idle' });
      }

      const nextStep = await resolvePendingFaqStep(supabase, run);
      if (nextStep) {
        await queueSend(
          supabase,
          ONBOARDING_FAQ_QUEUE,
          {
            run_id: run.id,
            workspace_id: run.workspace_id,
            step: nextStep,
            attempt: 1,
          },
          0,
        );
      }

      await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');

      return corsResponse({
        ok: true,
        nudged: true,
        run_id: run.id,
        status: run.status,
        current_step: run.current_step_key,
        next_step: nextStep ?? run.current_step_key,
      });
    }

    if (workflowKey === 'email_import') {
      let query = supabase
        .from('pipeline_runs')
        .select('id, workspace_id, config_id, state, params, metrics, created_at')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'email')
        .eq('state', 'running')
        .order('created_at', { ascending: false })
        .limit(1);

      if (requestedRunId) {
        query = query.eq('id', requestedRunId);
      }

      const { data: emailRun, error: emailRunError } = await query.maybeSingle();
      if (emailRunError) {
        throw new HttpError(500, `Failed to load email import run: ${emailRunError.message}`);
      }

      if (!emailRun) {
        return corsResponse({ ok: true, nudged: false, status: 'idle' });
      }

      await queueSend(
        supabase,
        'bb_import_jobs',
        buildImportResumeJob(emailRun as ImportRunRow) as Record<string, unknown>,
        0,
      );
      await wakeWorker(supabase, 'pipeline-worker-import');

      return corsResponse({
        ok: true,
        nudged: true,
        run_id: emailRun.id,
        status: emailRun.state,
        current_step: 'importing',
        next_step: 'importing',
      });
    }

    const run = await loadLatestRun(supabase, workspaceId, 'own_website_scrape', requestedRunId);
    if (!run) {
      return corsResponse({ ok: true, nudged: false, status: 'idle' });
    }

    const nextStep = await resolvePendingWebsiteStep(supabase, run);
    if (nextStep) {
      await queueSend(
        supabase,
        ONBOARDING_WEBSITE_QUEUE,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: nextStep,
          attempt: 1,
        },
        0,
      );
    }

    await wakeWorker(supabase, 'pipeline-worker-onboarding-website');

    return corsResponse({
      ok: true,
      nudged: true,
      run_id: run.id,
      status: run.status,
      current_step: run.current_step_key,
      next_step: nextStep ?? run.current_step_key,
    });
  } catch (error) {
    console.error('onboarding-worker-nudge error', error);
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
