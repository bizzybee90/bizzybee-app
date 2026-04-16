import { createServiceClient, HttpError, queueSend, wakeWorker } from '../_shared/pipeline.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  ONBOARDING_DISCOVERY_QUEUE,
  ONBOARDING_FAQ_QUEUE,
  ONBOARDING_WEBSITE_QUEUE,
} from '../_shared/onboarding.ts';
import { getNextMissingWebsiteBatch } from '../_shared/onboarding-website-runner.ts';

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

/**
 * Returns the number of pages in the latest `website_pages` artifact for a
 * given run, or 0 if the artifact doesn't exist yet. Used by the own-site
 * enqueue path to compute batch_count (1 page = 1 batch per
 * WEBSITE_EXTRACTION_BATCH_SIZE in onboarding-ai.ts) before asking
 * `getNextMissingWebsiteBatch` which batch to enqueue.
 */
async function loadWebsitePagesCount(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('content')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', 'website_pages')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, `Failed to load website_pages artifact: ${error.message}`);
  }
  if (!data?.content) return 0;

  const pages = (data.content as { pages?: unknown[] }).pages;
  return Array.isArray(pages) ? pages.length : 0;
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

/**
 * Map the FAQ workflow's queue-step key onto the agent_run_steps step_key so
 * we can detect when a step is already actively running and skip the nudge.
 * Without this check, a UI poll that lands while fetch_pages is mid-scrape
 * sees `hasPages=false` and enqueues a second fetch_pages job — two workers
 * then race on Apify quota and cause the duplicate-delivery regression
 * observed on 2026-04-16 (6/16 vs 1/16 scrape rate across concurrent
 * attempts).
 */
const FAQ_STEP_RUN_KEY: Record<string, string> = {
  load_context: 'faq:load_context',
  fetch_pages: 'faq:fetch_pages',
  generate_candidates: 'faq:generate_candidates',
  dedupe: 'faq:dedupe',
  finalize: 'faq:finalize',
  persist: 'faq:persist',
};

async function isFaqStepInFlight(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
  queueStep: string,
): Promise<boolean> {
  const runKey = FAQ_STEP_RUN_KEY[queueStep];
  if (!runKey) return false;

  const { count, error } = await supabase
    .from('agent_run_steps')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', run.id)
    .eq('step_key', runKey)
    .eq('status', 'running');

  if (error) {
    console.warn('[nudge] failed to check in-flight faq step', {
      run_id: run.id,
      step: queueStep,
      error: error.message,
    });
    // Fail open — if we can't query, don't silently re-enqueue. Treat as
    // in-flight to be safe; the real retry path is the pipeline-supervisor
    // at its slower cadence.
    return true;
  }

  return (count ?? 0) > 0;
}

async function nextFaqStepOrInFlight(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
  candidate: string,
): Promise<string | null> {
  if (await isFaqStepInFlight(supabase, run, candidate)) {
    console.warn('[nudge] faq step already running, not re-enqueuing', {
      run_id: run.id,
      step: candidate,
    });
    return null;
  }
  return candidate;
}

async function resolvePendingFaqStep(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
) {
  const hasContext = await hasRunArtifact(supabase, run.id, run.workspace_id, 'faq_context');
  if (!hasContext) return nextFaqStepOrInFlight(supabase, run, 'load_context');

  const hasPages = await hasRunArtifact(supabase, run.id, run.workspace_id, 'faq_pages');
  if (!hasPages) return nextFaqStepOrInFlight(supabase, run, 'fetch_pages');

  const hasRawCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'faq_candidates_raw',
  );
  if (!hasRawCandidates) return nextFaqStepOrInFlight(supabase, run, 'generate_candidates');

  const hasDedupedCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'faq_candidates_deduped',
  );
  if (!hasDedupedCandidates) return nextFaqStepOrInFlight(supabase, run, 'dedupe');

  const hasFinalCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'faq_candidates_final',
  );
  if (!hasFinalCandidates) return nextFaqStepOrInFlight(supabase, run, 'finalize');

  const { count, error } = await supabase
    .from('faq_database')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', run.workspace_id)
    .eq('is_own_content', false);

  if (error) {
    throw new HttpError(500, `Failed to inspect competitor FAQ rows: ${error.message}`);
  }

  return (count || 0) > 0 ? null : nextFaqStepOrInFlight(supabase, run, 'persist');
}

/**
 * Same in-flight-check pattern as FAQ_STEP_RUN_KEY above. Without this, the
 * own-site knowledge extraction spawned concurrent Claude batches — user
 * observed 2026-04-16 that the progress counter appeared to "reset" (e.g.
 * 10/12 → 7/12) because three website:extract workers were racing against
 * the same run's output_summary.
 *
 * NOTE: `extract` is intentionally omitted here — Task 3 split it into
 * per-batch step records (website:extract_batch_0, _batch_1, ...), so the
 * in-flight check below uses a LIKE prefix match instead of an exact lookup
 * via this map.
 */
const WEBSITE_STEP_RUN_KEY: Record<string, string> = {
  fetch: 'website:fetch',
  persist: 'website:persist',
};

async function isWebsiteStepInFlight(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
  queueStep: string,
): Promise<boolean> {
  // Task 3 split 'website:extract' into per-batch step records
  // (website:extract_batch_0, _batch_1, ...). Use a LIKE prefix match for
  // the extract step; exact match for fetch/persist.
  let query = supabase
    .from('agent_run_steps')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', run.id)
    .eq('status', 'running');

  if (queueStep === 'extract') {
    query = query.like('step_key', 'website:extract_batch_%');
  } else {
    const runKey = WEBSITE_STEP_RUN_KEY[queueStep];
    if (!runKey) return false;
    query = query.eq('step_key', runKey);
  }

  const { count, error } = await query;

  if (error) {
    console.warn('[nudge] failed to check in-flight website step', {
      run_id: run.id,
      step: queueStep,
      error: error.message,
    });
    // Fail open: treat as in-flight. Better to miss a nudge (supervisor
    // will retry) than to silently spawn a second concurrent extract.
    return true;
  }

  return (count ?? 0) > 0;
}

async function nextWebsiteStepOrInFlight(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
  candidate: string,
): Promise<string | null> {
  if (await isWebsiteStepInFlight(supabase, run, candidate)) {
    console.warn('[nudge] website step already running, not re-enqueuing', {
      run_id: run.id,
      step: candidate,
    });
    return null;
  }
  return candidate;
}

async function resolvePendingWebsiteStep(
  supabase: ReturnType<typeof createServiceClient>,
  run: RunRow,
) {
  const hasPages = await hasRunArtifact(supabase, run.id, run.workspace_id, 'website_pages');
  if (!hasPages) return nextWebsiteStepOrInFlight(supabase, run, 'fetch');

  const hasCandidates = await hasRunArtifact(
    supabase,
    run.id,
    run.workspace_id,
    'website_faq_candidates',
  );
  if (!hasCandidates) return nextWebsiteStepOrInFlight(supabase, run, 'extract');

  const { count, error } = await supabase
    .from('faq_database')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', run.workspace_id)
    .eq('is_own_content', true);

  if (error) {
    throw new HttpError(500, `Failed to inspect website FAQ rows: ${error.message}`);
  }

  return (count || 0) > 0 ? null : nextWebsiteStepOrInFlight(supabase, run, 'persist');
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
      if (nextStep === 'extract') {
        // Load page count to know batch_count (1 page = 1 batch per
        // onboarding-ai.ts:61 WEBSITE_EXTRACTION_BATCH_SIZE). If no pages
        // artifact yet, fall back to enqueueing extract without batch_index
        // so the runner's resolver picks it up — the resolver also handles
        // the "no pages yet" edge case by normalizing to fetch.
        const pageCount = await loadWebsitePagesCount(supabase, run.id, run.workspace_id);
        if (pageCount > 0) {
          const nextBatch = await getNextMissingWebsiteBatch(
            supabase,
            run.id,
            run.workspace_id,
            pageCount,
          );
          if (nextBatch === null) {
            // All batch artifacts present — the extract phase is actually
            // complete; move straight to persist. This covers the case
            // where resolvePendingWebsiteStep still reports 'extract'
            // because the consolidated website_faq_candidates artifact
            // hasn't been written yet (persist is the one that writes it).
            await queueSend(
              supabase,
              ONBOARDING_WEBSITE_QUEUE,
              {
                run_id: run.id,
                workspace_id: run.workspace_id,
                step: 'persist',
                attempt: 1,
              },
              0,
            );
          } else {
            await queueSend(
              supabase,
              ONBOARDING_WEBSITE_QUEUE,
              {
                run_id: run.id,
                workspace_id: run.workspace_id,
                step: 'extract',
                attempt: 1,
                batch_index: nextBatch,
              },
              0,
            );
          }
        } else {
          // No pages artifact yet — runner's resolver will normalize
          // 'extract' to 'fetch' on receipt.
          await queueSend(
            supabase,
            ONBOARDING_WEBSITE_QUEUE,
            {
              run_id: run.id,
              workspace_id: run.workspace_id,
              step: 'extract',
              attempt: 1,
            },
            0,
          );
        }
      } else {
        // fetch or persist — no batch_index on the payload.
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
