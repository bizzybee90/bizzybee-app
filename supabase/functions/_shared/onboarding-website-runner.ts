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
  type FaqCandidate,
  type FetchedPage,
} from '../faq-agent-runner/lib/onboarding-ai.ts';
import {
  buildFaqRows,
  extractFaqCandidatesFromPages,
  hasRunArtifact,
  loadRunArtifact,
} from './onboarding-faq-engine.ts';

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
   * current message msg_id and passes it in — we call it at step entry
   * and after each Claude batch inside the extract loop, so pgmq doesn't
   * redeliver the message mid-processing when extract takes longer than
   * the VT. See pipeline-worker-onboarding-website/index.ts for the
   * motivation.
   */
  heartbeat?: () => Promise<void>;
}

export async function executeWebsiteRunStep(
  supabase: SupabaseClient,
  run: WebsiteRunRecord,
  requestedStep: WebsiteWorkflowStep,
  attempt: number,
  options: WebsiteRunStepOptions = {},
): Promise<{ executedStep: WebsiteWorkflowStep | null }> {
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
    const stepRecord = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'website:extract',
      attempt,
      provider: 'claude',
      model,
    });

    await supabase
      .from('scraping_jobs')
      .update({
        status: 'extracting',
      })
      .eq('id', sourceJobId);

    try {
      const { pages } = await loadRunArtifact<{ pages: FetchedPage[] }>(
        supabase,
        run.id,
        run.workspace_id,
        'website_pages',
      );
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', run.workspace_id)
        .maybeSingle();
      const { data: businessContext } = await supabase
        .from('business_context')
        .select('industry, service_area, business_type')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle();

      const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
      if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

      const extracted = await withTransientRetry(() =>
        extractFaqCandidatesFromPages({
          sourceKind: 'own_site',
          apiKey: anthropicApiKey,
          model,
          context: {
            workspace_name: workspace?.name || 'BizzyBee workspace',
            industry: businessContext?.industry ?? null,
            service_area: businessContext?.service_area ?? null,
            business_type: businessContext?.business_type ?? null,
          },
          pages,
          onWebsiteProgress: async (progress) => {
            // Heartbeat keeps the pgmq VT ahead of the Claude batch loop
            // wall-clock (12 batches x ~40s = ~8 min, far longer than the
            // 180s VT). Internally rate-limited so it's cheap to call
            // every batch.
            if (heartbeat) {
              await heartbeat();
            }
            await touchAgentRun(supabase, {
              runId: run.id,
              status: 'running',
              currentStepKey: 'website:extract',
              outputSummaryPatch: {
                website_extract_progress: {
                  batch_index: progress.batchIndex,
                  batch_count: progress.batchCount,
                  pages_in_batch: progress.pagesInBatch,
                  pages_total: pages.length,
                  candidate_count: progress.candidateCount,
                  total_candidate_count: progress.totalCandidateCount,
                },
              },
            });
            await supabase
              .from('scraping_jobs')
              .update({
                status: 'extracting',
                faqs_found: progress.totalCandidateCount,
              })
              .eq('id', sourceJobId);
          },
        }),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'website_faq_candidates',
        content: { faqs: extracted.faqs, batch_count: extracted.batchCount } as Record<
          string,
          unknown
        >,
        stepId: stepRecord.id,
      });

      await supabase
        .from('scraping_jobs')
        .update({
          status: 'extracting',
          faqs_found: extracted.faqs.length,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, stepRecord.id, {
        faq_count: extracted.faqs.length,
        batch_count: extracted.batchCount,
      });
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
