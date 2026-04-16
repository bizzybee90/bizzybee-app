import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  failRun,
  recordRunArtifact,
  resolveStepModel,
  succeedRun,
  touchAgentRun,
  type OnboardingWorkflowKey,
} from './onboarding.ts';
import { loadRunRecord, withTransientRetry } from './onboarding-worker.ts';
import { beginStep, failStep, succeedStep } from '../faq-agent-runner/lib/step-recorder.ts';
import {
  crawlWebsitePages,
  extractWebsiteFaqs,
  type FaqCandidate,
  type FetchedPage,
} from '../faq-agent-runner/lib/onboarding-ai.ts';
import { buildFaqRows, hasRunArtifact, loadRunArtifact } from './onboarding-faq-engine.ts';

/**
 * Return the lowest batch_index whose `website_faq_candidates_batch_{N}`
 * artifact does not yet exist, or null if all batches are written.
 * Callers: runner (when batch_index is omitted from the payload) and
 * onboarding-worker-nudge (to enqueue the right batch on nudge).
 */
export async function getNextMissingWebsiteBatch(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
  batchCount: number,
): Promise<number | null> {
  if (batchCount <= 0) return null;

  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('artifact_key')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .like('artifact_key', 'website_faq_candidates_batch_%');

  if (error) {
    throw new Error(`Failed to look up website extract batch artifacts: ${error.message}`);
  }

  const present = new Set<number>();
  for (const row of data ?? []) {
    const match = /^website_faq_candidates_batch_(\d+)$/.exec(row.artifact_key ?? '');
    if (match) {
      present.add(Number(match[1]));
    }
  }

  for (let i = 0; i < batchCount; i++) {
    if (!present.has(i)) return i;
  }
  return null;
}

/**
 * Sum `faqs.length` across all `website_faq_candidates_batch_{N}` artifacts
 * for a given run. Used by the extract branch to populate
 * `output_summary.website_extract_progress.total_candidate_count` so the UI
 * shows a rolling running total as each batch completes. Returns 0 if no
 * batch artifacts exist yet.
 */
async function sumWebsiteBatchCandidateCounts(
  supabase: SupabaseClient,
  runId: string,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('content')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .like('artifact_key', 'website_faq_candidates_batch_%');

  if (error) {
    throw new Error(`Failed to sum website batch candidate counts: ${error.message}`);
  }

  let total = 0;
  for (const row of data ?? []) {
    const content = (row.content ?? null) as { faqs?: unknown[] } | null;
    if (Array.isArray(content?.faqs)) {
      total += content.faqs.length;
    }
  }
  return total;
}

export type WebsiteWorkflowStep = 'fetch' | 'extract' | 'persist';

type WebsiteRunRecord = Awaited<ReturnType<typeof loadRunRecord>>;

function normalizeWebsiteStep(
  requestedStep: WebsiteWorkflowStep,
  pendingStep: WebsiteWorkflowStep | null,
): WebsiteWorkflowStep | null {
  if (!pendingStep) return null;

  const order: Record<WebsiteWorkflowStep, number> = {
    fetch: 1,
    extract: 2,
    persist: 3,
  };

  return order[pendingStep] > order[requestedStep] ? pendingStep : requestedStep;
}

export async function resolvePendingWebsiteStep(
  supabase: SupabaseClient,
  run: WebsiteRunRecord,
): Promise<WebsiteWorkflowStep | null> {
  if (run.workflow_key !== 'own_website_scrape') return null;
  if (run.status === 'failed' || run.status === 'canceled') return null;

  const [hasPages, hasCandidates, persistedJob, persistedFaqs] = await Promise.all([
    hasRunArtifact(supabase, run.id, run.workspace_id, 'website_pages'),
    hasRunArtifact(supabase, run.id, run.workspace_id, 'website_faq_candidates'),
    run.source_job_id
      ? supabase.from('scraping_jobs').select('status').eq('id', run.source_job_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('faq_database')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', run.workspace_id)
      .eq('is_own_content', true),
  ]);

  if (persistedJob.error) {
    throw new Error(`Failed to inspect scraping job state: ${persistedJob.error.message}`);
  }

  if (persistedFaqs.error) {
    throw new Error(`Failed to inspect persisted website FAQs: ${persistedFaqs.error.message}`);
  }

  const scrapingStatus = persistedJob.data?.status ?? null;
  const storedFaqCount = persistedFaqs.count ?? 0;

  if (!hasPages) return 'fetch';
  if (!hasCandidates) return 'extract';
  if (scrapingStatus === 'completed' || storedFaqCount > 0 || run.status === 'succeeded') {
    return null;
  }

  return 'persist';
}

export interface WebsiteRunStepOptions {
  /**
   * Optional pgmq heartbeat. The worker creates a heartbeat tied to its
   * current message msg_id and passes it in — we call it once at step
   * entry so pgmq doesn't redeliver the message mid-Claude-call. A single
   * batch runs for ~40s, well under the 60s heartbeat interval, so one
   * beat per invocation is sufficient. See
   * pipeline-worker-onboarding-website/index.ts for the motivation.
   */
  heartbeat?: () => Promise<void>;

  /**
   * Only meaningful when `requestedStep === 'extract'`. Tells the runner
   * which page batch to process (0-indexed). When omitted, the runner
   * resolves the next missing batch from artifacts. The caller — the
   * pipeline worker — threads this through from the pgmq message payload
   * so re-delivery of the same message processes the same batch.
   */
  batchIndex?: number;
}

export interface WebsiteRunStepResult {
  executedStep: WebsiteWorkflowStep | null;
  /** Populated on extract step only. */
  batchIndex?: number;
  /** Populated on extract step only. Equals `pages.length` (batch size 1). */
  batchCount?: number;
  /**
   * Populated on extract step only. True iff every batch artifact
   * `website_faq_candidates_batch_{0..batchCount-1}` is present after this
   * invocation. The worker uses this to decide whether to enqueue the
   * next batch or move to persist.
   */
  allBatchesDone?: boolean;
}

/**
 * Runs Claude for exactly one page batch of the extract step. Writes the
 * per-batch artifact, updates run progress, and records a per-batch step.
 *
 * On retry-exhausted failure: writes an EMPTY batch artifact with
 * `batch_skipped: true` and succeeds the step record. This mirrors the
 * behaviour of the old in-loop `extractWebsiteFaqsInChunks` — losing one
 * batch of candidates is preferable to stalling the whole chain. Any
 * other exception (e.g. supabase write failure) is rethrown so the worker
 * can requeue.
 */
async function executeExtractOneBatch(params: {
  supabase: SupabaseClient;
  run: WebsiteRunRecord;
  attempt: number;
  batchIndex: number;
  /** ALL pages — the helper slices internally. */
  pages: FetchedPage[];
  heartbeat?: () => Promise<void>;
}): Promise<{ candidateCount: number; totalCandidateCount: number; batchCount: number }> {
  const { supabase, run, attempt, batchIndex, pages, heartbeat } = params;
  const batchCount = pages.length;
  const pagesInBatch = pages.slice(batchIndex, batchIndex + 1);
  const model = resolveStepModel(run.input_snapshot, 'extract');

  const stepRecord = await beginStep({
    supabase,
    runId: run.id,
    workspaceId: run.workspace_id,
    stepKey: `website:extract_batch_${batchIndex}`,
    attempt,
    provider: 'claude',
    model,
  });

  try {
    const [{ data: workspace }, { data: businessContext }] = await Promise.all([
      supabase.from('workspaces').select('name').eq('id', run.workspace_id).maybeSingle(),
      supabase
        .from('business_context')
        .select('industry, service_area, business_type')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle(),
    ]);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
    if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    // Single beat at entry — the Claude call is ~40s which is well under
    // the 60s heartbeat interval, so we don't need to beat in the middle.
    if (heartbeat) await heartbeat();

    const context = {
      workspace_name: workspace?.name || 'BizzyBee workspace',
      industry: businessContext?.industry ?? null,
      service_area: businessContext?.service_area ?? null,
      business_type: businessContext?.business_type ?? null,
    };

    let faqs: FaqCandidate[] = [];
    let batchSkipped = false;
    try {
      const extracted = await withTransientRetry(() =>
        extractWebsiteFaqs(anthropicApiKey, model, context, pagesInBatch),
      );
      faqs = Array.isArray(extracted?.faqs) ? extracted.faqs : [];
    } catch (err) {
      // Retry exhausted — mirror extractWebsiteFaqsInChunks' "skip the
      // batch, keep going" behaviour. We MUST NOT rethrow here, because
      // rethrowing stalls the pgmq chain (the worker requeues this same
      // batch forever, and the next batch never fires).
      batchSkipped = true;
      console.warn('[executeExtractOneBatch] batch failed after retries — skipping', {
        run_id: run.id,
        batch_index: batchIndex,
        batch_count: batchCount,
        pages_in_batch: pagesInBatch.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await recordRunArtifact(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      artifactType: 'faq_candidate_batch',
      artifactKey: `website_faq_candidates_batch_${batchIndex}`,
      content: {
        faqs,
        batch_index: batchIndex,
        batch_count: batchCount,
        ...(batchSkipped ? { batch_skipped: true } : {}),
      } as Record<string, unknown>,
      stepId: stepRecord.id,
    });

    const totalSoFar = await sumWebsiteBatchCandidateCounts(supabase, run.id, run.workspace_id);

    // Keep scraping_jobs' running faqs_found in sync so the legacy UI has
    // something to show. Best-effort: scrape job might be missing.
    if (run.source_job_id) {
      await supabase
        .from('scraping_jobs')
        .update({ status: 'extracting', faqs_found: totalSoFar })
        .eq('id', run.source_job_id);
    }

    await touchAgentRun(supabase, {
      runId: run.id,
      status: 'running',
      currentStepKey: 'website:extract',
      outputSummaryPatch: {
        website_extract_progress: {
          // UI shows 1-indexed "AI pass N of M"; we control writes serially
          // now so a simple `batchIndex + 1` is monotonic per-run.
          batch_index: batchIndex + 1,
          batch_count: batchCount,
          pages_in_batch: pagesInBatch.length,
          pages_total: pages.length,
          candidate_count: faqs.length,
          total_candidate_count: totalSoFar,
        },
      },
    });

    await succeedStep(supabase, stepRecord.id, {
      faq_count: faqs.length,
      batch_index: batchIndex,
      ...(batchSkipped ? { batch_skipped: true } : {}),
    });

    return {
      candidateCount: faqs.length,
      totalCandidateCount: totalSoFar,
      batchCount,
    };
  } catch (error) {
    await failStep(supabase, stepRecord.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function executeWebsiteRunStep(
  supabase: SupabaseClient,
  run: WebsiteRunRecord,
  requestedStep: WebsiteWorkflowStep,
  attempt: number,
  options: WebsiteRunStepOptions = {},
): Promise<WebsiteRunStepResult> {
  const heartbeat = options.heartbeat;
  const sourceJobId = run.source_job_id;
  if (!sourceJobId) {
    await failRun(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: 'own_website_scrape',
      reason: 'Website scrape run is missing its scrape job reference',
      details: { requested_step: requestedStep },
    });
    return { executedStep: null };
  }

  const websiteUrl =
    typeof run.input_snapshot.website_url === 'string' ? run.input_snapshot.website_url : '';
  if (!websiteUrl) {
    await failRun(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: 'own_website_scrape',
      reason: 'Website scrape run is missing its target website URL',
      details: { requested_step: requestedStep },
    });
    return { executedStep: null };
  }

  const pendingStep = await resolvePendingWebsiteStep(supabase, run);
  const step = normalizeWebsiteStep(requestedStep, pendingStep);
  if (!step) {
    return { executedStep: null };
  }

  const model = resolveStepModel(run.input_snapshot, step);
  const now = new Date().toISOString();

  await touchAgentRun(supabase, {
    runId: run.id,
    status: 'running',
    currentStepKey: step,
  });

  if (step === 'fetch') {
    const stepRecord = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'website:fetch',
      attempt,
      provider: 'apify',
      model,
      inputPayload: { website_url: websiteUrl },
    });

    try {
      const pages = await withTransientRetry(() => crawlWebsitePages(websiteUrl, 8));

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'source_page_batch',
        artifactKey: 'website_pages',
        content: { pages },
        stepId: stepRecord.id,
        sourceUrl: websiteUrl,
      });

      await supabase
        .from('scraping_jobs')
        .update({
          status: 'scraping',
          total_pages_found: pages.length,
          pages_processed: pages.length,
          started_at: now,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, stepRecord.id, { page_count: pages.length });
      return { executedStep: step };
    } catch (error) {
      await failStep(
        supabase,
        stepRecord.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  if (step === 'extract') {
    // Load pages once. batchCount == pages.length (WEBSITE_EXTRACTION_BATCH_SIZE
    // in onboarding-ai.ts is 1 page per batch, so one page ↔ one batch).
    const { pages } = await loadRunArtifact<{ pages: FetchedPage[] }>(
      supabase,
      run.id,
      run.workspace_id,
      'website_pages',
    );
    const batchCount = pages.length;

    // Keep scraping_jobs.status in the 'extracting' state so the legacy UI
    // has something to show while batches tick through.
    await supabase.from('scraping_jobs').update({ status: 'extracting' }).eq('id', sourceJobId);

    const effectiveBatch =
      options.batchIndex ??
      (await getNextMissingWebsiteBatch(supabase, run.id, run.workspace_id, batchCount));

    if (effectiveBatch === null) {
      // All batches already have artifacts — the caller (worker) should
      // move to persist. Nothing to do here.
      return { executedStep: 'extract', batchCount, allBatchesDone: true };
    }

    // Guard: once we have a non-null batch index, it MUST be addressable
    // against the loaded pages array. Task 4 will wire up the worker's
    // chain-next-batch logic — if that ever mis-computes next_batch_index
    // (e.g. off-by-one at boundary, or stale batchCount) we'd otherwise
    // silently slice an empty window from `pages`, call Claude with zero
    // pages, and corrupt website_extract_progress.batch_index. Fail loud
    // instead so the worker's failure path catches it.
    if (effectiveBatch < 0 || effectiveBatch >= batchCount) {
      throw new Error(
        `Invalid batch_index ${effectiveBatch} for website extract run ${run.id} ` +
          `(batchCount=${batchCount})`,
      );
    }

    // Idempotency: if this exact batch artifact already exists (worker
    // restarted mid-chain and re-delivered us the same msg), short-circuit
    // without re-calling Claude. Compute allBatchesDone by checking if
    // there's still a gap anywhere in [0, batchCount).
    const alreadyDone = await hasRunArtifact(
      supabase,
      run.id,
      run.workspace_id,
      `website_faq_candidates_batch_${effectiveBatch}`,
    );
    if (alreadyDone) {
      const nextMissing = await getNextMissingWebsiteBatch(
        supabase,
        run.id,
        run.workspace_id,
        batchCount,
      );
      return {
        executedStep: 'extract',
        batchIndex: effectiveBatch,
        batchCount,
        allBatchesDone: nextMissing === null,
      };
    }

    await executeExtractOneBatch({
      supabase,
      run,
      attempt,
      batchIndex: effectiveBatch,
      pages,
      heartbeat,
    });

    const nextMissing = await getNextMissingWebsiteBatch(
      supabase,
      run.id,
      run.workspace_id,
      batchCount,
    );
    return {
      executedStep: 'extract',
      batchIndex: effectiveBatch,
      batchCount,
      allBatchesDone: nextMissing === null,
    };
  }

  const stepRecord = await beginStep({
    supabase,
    runId: run.id,
    workspaceId: run.workspace_id,
    stepKey: 'website:persist',
    attempt,
    provider: 'supabase',
    model,
  });

  try {
    const { faqs } = await loadRunArtifact<{ faqs: FaqCandidate[] }>(
      supabase,
      run.id,
      run.workspace_id,
      'website_faq_candidates',
    );

    if (!faqs || faqs.length < 3) {
      throw new Error('Not enough grounded website FAQs were extracted');
    }

    await supabase
      .from('faq_database')
      .delete()
      .eq('workspace_id', run.workspace_id)
      .eq('is_own_content', true);

    const faqRows = buildFaqRows({
      workspaceId: run.workspace_id,
      faqs,
      category: 'knowledge_base',
      isOwnContent: true,
    });

    const { error: insertError } = await supabase.from('faq_database').insert(faqRows);
    if (insertError) {
      throw new Error(`Failed to persist website FAQs: ${insertError.message}`);
    }

    await supabase
      .from('scraping_jobs')
      .update({
        status: 'completed',
        faqs_found: faqs.length,
        faqs_stored: faqs.length,
        completed_at: now,
      })
      .eq('id', sourceJobId);

    await succeedStep(supabase, stepRecord.id, { faq_count: faqs.length });
    await succeedRun(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: 'own_website_scrape',
      outputSummaryPatch: {
        faq_count: faqs.length,
        website_url: websiteUrl,
      },
    });

    return { executedStep: step };
  } catch (error) {
    await failStep(supabase, stepRecord.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function loadLatestWebsiteRun(
  supabase: SupabaseClient,
  workspaceId: string,
  runId?: string | null,
): Promise<WebsiteRunRecord | null> {
  if (runId) {
    return loadRunRecord(supabase, runId).catch(() => null);
  }

  const { data, error } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('workflow_key', 'own_website_scrape' satisfies OnboardingWorkflowKey)
    .in('status', ['queued', 'running', 'waiting', 'succeeded'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest website onboarding run: ${error.message}`);
  }

  if (!data?.id) return null;
  return loadRunRecord(supabase, data.id);
}
