import {
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  assertWorkerToken,
  createServiceClient,
  jsonResponse,
  queueDelete,
  queueSend,
  readQueue,
  withinBudget,
} from '../_shared/pipeline.ts';
import {
  ONBOARDING_FAQ_QUEUE,
  recordRunArtifact,
  resolveStepModel,
  succeedRun,
  touchAgentRun,
  type OnboardingFaqJob,
} from '../_shared/onboarding.ts';
import {
  deadletterStepJob,
  loadRunRecord,
  requeueStepJob,
  withTransientRetry,
} from '../_shared/onboarding-worker.ts';
import { beginStep, failStep, succeedStep } from '../faq-agent-runner/lib/step-recorder.ts';
import {
  extractCompetitorFaqCandidates,
  finalizeFaqCandidates,
  type FaqCandidate,
  type FetchedPage,
} from '../faq-agent-runner/lib/onboarding-ai.ts';
import { handleFetchSourcePage } from '../faq-agent-runner/tools/fetch-source-page.ts';
import { handleGetRunContext, type RunContext } from '../faq-agent-runner/tools/get-run-context.ts';
import { handleListExistingFaqs } from '../faq-agent-runner/tools/list-existing-faqs.ts';
import { handleMirrorProgress } from '../faq-agent-runner/tools/mirror-progress.ts';

const QUEUE_NAME = ONBOARDING_FAQ_QUEUE;
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 5;

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadArtifact<T>(
  runId: string,
  workspaceId: string,
  artifactKey: string,
): Promise<T> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .select('content')
    .eq('run_id', runId)
    .eq('workspace_id', workspaceId)
    .eq('artifact_key', artifactKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Missing onboarding artifact: ${artifactKey}`);
  }

  return data.content as T;
}

async function processJob(
  record: { msg_id: number; read_ct: number; message: OnboardingFaqJob },
  startMs: number,
) {
  const supabase = createServiceClient();
  const job = record.message;
  const run = await loadRunRecord(supabase, job.run_id);

  if (run.workflow_key !== 'faq_generation') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const sourceJobId = run.source_job_id;
  const model = resolveStepModel(run.input_snapshot, job.step);
  const targetCount = Math.max(3, Math.min(15, Number(run.input_snapshot.target_count || 10)));

  await touchAgentRun(supabase, {
    runId: run.id,
    status: 'running',
    currentStepKey: job.step,
  });

  if (job.step === 'load_context') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:load_context',
      attempt: job.attempt,
      provider: 'runner',
      model,
    });

    try {
      const context = await handleGetRunContext(supabase, { run_id: run.id });
      if (!context.allowed_urls.length) {
        throw new Error('No allowlisted competitor URLs were available');
      }

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'context_snapshot',
        artifactKey: 'faq_context',
        content: context as unknown as Record<string, unknown>,
        stepId: step.id,
      });

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'context_loaded',
          summary: 'Loaded competitor FAQ context',
          metadata: { allowed_url_count: context.allowed_urls.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { allowed_url_count: context.allowed_urls.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'fetch_pages',
          attempt: 1,
        },
        0,
      );
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'fetch_pages') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:fetch_pages',
      attempt: job.attempt,
      provider: 'apify',
      model,
    });

    try {
      const context = await loadArtifact<RunContext>(run.id, run.workspace_id, 'faq_context');
      const selectedCompetitorIds = Array.isArray(run.input_snapshot.selected_competitor_ids)
        ? run.input_snapshot.selected_competitor_ids.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];

      let competitorQuery = supabase
        .from('competitor_sites')
        .select('id, business_name, url')
        .eq('workspace_id', run.workspace_id)
        .eq('is_selected', true)
        .neq('status', 'rejected');

      if (selectedCompetitorIds.length > 0) {
        competitorQuery = competitorQuery.in('id', selectedCompetitorIds);
      }

      const { data: competitors, error: competitorsError } = await competitorQuery;
      if (competitorsError) {
        throw new Error(`Failed to load competitor rows: ${competitorsError.message}`);
      }

      const businessNameByUrl = new Map<string, string>();
      for (const competitor of competitors || []) {
        if (competitor.url) {
          businessNameByUrl.set(competitor.url, competitor.business_name || competitor.url);
        }
      }

      const pages: Array<FetchedPage & { source_business?: string }> = [];
      for (const url of context.allowed_urls.slice(0, targetCount)) {
        const page = await withTransientRetry(() =>
          handleFetchSourcePage(
            supabase,
            { url, run_id: run.id },
            run.workspace_id,
            context.allowed_urls,
          ),
        );
        pages.push({
          ...page,
          source_business: businessNameByUrl.get(url) || url,
        });
      }

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'source_page_batch',
        artifactKey: 'faq_pages',
        content: { pages },
        stepId: step.id,
      });

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'scraping',
            sites_scraped: pages.length,
            pages_scraped: pages.length,
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'fetch_complete',
          summary: 'Fetched selected competitor pages',
          metadata: { page_count: pages.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { page_count: pages.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'generate_candidates',
          attempt: 1,
        },
        0,
      );
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'generate_candidates') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:generate_candidates',
      attempt: job.attempt,
      provider: 'claude',
      model,
    });

    try {
      const { pages } = await loadArtifact<{
        pages: Array<FetchedPage & { source_business?: string }>;
      }>(run.id, run.workspace_id, 'faq_pages');
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
        extractCompetitorFaqCandidates(
          anthropicApiKey,
          model,
          {
            workspace_name: workspace?.name || 'BizzyBee workspace',
            industry: businessContext?.industry ?? null,
            service_area: businessContext?.service_area ?? null,
            business_type: businessContext?.business_type ?? null,
          },
          pages,
        ),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'faq_candidates_raw',
        content: extracted as Record<string, unknown>,
        stepId: step.id,
      });

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'extracting',
            faqs_extracted: extracted.candidates.length,
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'candidates_generated',
          summary: 'Generated competitor FAQ candidates',
          metadata: { candidate_count: extracted.candidates.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { candidate_count: extracted.candidates.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'dedupe',
          attempt: 1,
        },
        0,
      );
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'dedupe') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:dedupe',
      attempt: job.attempt,
      provider: 'runner',
      model,
    });

    try {
      const { candidates } = await loadArtifact<{ candidates: FaqCandidate[] }>(
        run.id,
        run.workspace_id,
        'faq_candidates_raw',
      );
      const existing = await handleListExistingFaqs(supabase, { workspace_id: run.workspace_id });

      const seenQuestions = new Set(existing.faqs.map((faq) => normalizeQuestion(faq.question)));
      const deduped: FaqCandidate[] = [];

      for (const candidate of candidates
        .filter((item) => item.question && item.answer && item.source_url && item.evidence_quote)
        .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))) {
        const key = normalizeQuestion(candidate.question);
        if (!key || seenQuestions.has(key)) continue;
        seenQuestions.add(key);
        deduped.push(candidate);
      }

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'faq_candidates_deduped',
        content: { candidates: deduped },
        stepId: step.id,
      });

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            faqs_after_dedup: deduped.length,
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await succeedStep(supabase, step.id, { candidate_count: deduped.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'finalize',
          attempt: 1,
        },
        0,
      );
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'finalize') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:finalize',
      attempt: job.attempt,
      provider: 'claude',
      model,
    });

    try {
      const { candidates } = await loadArtifact<{ candidates: FaqCandidate[] }>(
        run.id,
        run.workspace_id,
        'faq_candidates_deduped',
      );
      const existing = await handleListExistingFaqs(supabase, { workspace_id: run.workspace_id });
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

      const finalized = await withTransientRetry(() =>
        finalizeFaqCandidates(
          anthropicApiKey,
          model,
          {
            workspace_name: workspace?.name || 'BizzyBee workspace',
            industry: businessContext?.industry ?? null,
            service_area: businessContext?.service_area ?? null,
            business_type: businessContext?.business_type ?? null,
          },
          candidates,
          existing.faqs.map((faq) => faq.question),
        ),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'faq_candidate_batch',
        artifactKey: 'faq_candidates_final',
        content: finalized as Record<string, unknown>,
        stepId: step.id,
      });

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'quality_review_complete',
          summary: 'Selected the strongest final competitor FAQs',
          metadata: { final_count: finalized.faqs.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { faq_count: finalized.faqs.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'persist',
          attempt: 1,
        },
        0,
      );
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  if (job.step === 'persist') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'faq:persist',
      attempt: job.attempt,
      provider: 'supabase',
      model,
    });

    try {
      const { faqs } = await loadArtifact<{ faqs: FaqCandidate[] }>(
        run.id,
        run.workspace_id,
        'faq_candidates_final',
      );

      if (!faqs || faqs.length < 3) {
        throw new Error('Fewer than 3 grounded competitor FAQs survived finalization');
      }

      const existing = await handleListExistingFaqs(supabase, { workspace_id: run.workspace_id });
      const existingQuestions = new Set(
        existing.faqs.map((faq) => normalizeQuestion(faq.question)),
      );
      const freshFaqs = faqs.filter(
        (faq) => !existingQuestions.has(normalizeQuestion(faq.question)),
      );

      if (freshFaqs.length < 3) {
        throw new Error('Competitor FAQ final set was fully duplicated by existing FAQs');
      }

      const faqRows = freshFaqs.map((faq) => ({
        workspace_id: run.workspace_id,
        question: faq.question,
        answer: faq.answer,
        category: 'competitor_research',
        enabled: true,
        is_active: true,
        is_own_content: false,
        source_url: faq.source_url,
        generation_source: faq.source_url,
        source_business: faq.source_business || null,
        source_company: faq.source_business || null,
        relevance_score: Math.round((faq.quality_score || 0) * 100),
      }));

      const { error: insertError } = await supabase.from('faq_database').insert(faqRows);
      if (insertError) {
        throw new Error(`Failed to persist competitor FAQs: ${insertError.message}`);
      }

      const faqCountsBySource = new Map<string, number>();
      for (const faq of freshFaqs) {
        faqCountsBySource.set(faq.source_url, (faqCountsBySource.get(faq.source_url) || 0) + 1);
      }

      for (const [sourceUrl, count] of faqCountsBySource.entries()) {
        await supabase
          .from('competitor_sites')
          .update({
            scrape_status: 'completed',
            scraped_at: new Date().toISOString(),
            faqs_generated: count,
            pages_scraped: 1,
          })
          .eq('workspace_id', run.workspace_id)
          .eq('url', sourceUrl);
      }

      if (sourceJobId) {
        await supabase
          .from('competitor_research_jobs')
          .update({
            status: 'complete',
            sites_scraped: faqCountsBySource.size,
            pages_scraped: faqCountsBySource.size,
            faqs_generated: freshFaqs.length,
            faqs_added: freshFaqs.length,
            completed_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', sourceJobId);
      }

      await handleMirrorProgress(
        supabase,
        {
          run_id: run.id,
          stage: 'finalized',
          summary: 'Persisted final competitor FAQs',
          metadata: { faq_count: freshFaqs.length },
        },
        run.workspace_id,
      );

      await succeedStep(supabase, step.id, { faq_count: freshFaqs.length });
      await succeedRun(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        workflowKey: 'faq_generation',
        outputSummaryPatch: {
          faq_count: freshFaqs.length,
          selected_competitor_ids: run.input_snapshot.selected_competitor_ids || [],
        },
      });
      await queueDelete(supabase, QUEUE_NAME, record.msg_id);
      return;
    } catch (error) {
      await failStep(supabase, step.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  await queueDelete(supabase, QUEUE_NAME, record.msg_id);
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();
    const jobs = await readQueue<OnboardingFaqJob>(supabase, QUEUE_NAME, VT_SECONDS, 2);

    let processed = 0;
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) break;

      try {
        await processJob(record, startMs);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (record.read_ct >= MAX_ATTEMPTS) {
          await deadletterStepJob(supabase, {
            queueName: QUEUE_NAME,
            workflowKey: 'faq_generation',
            scope: 'pipeline-worker-onboarding-faq',
            record: record as unknown as {
              msg_id: number;
              read_ct: number;
              message: Record<string, unknown>;
            },
            errorMessage: message,
          });
        } else {
          await requeueStepJob(
            supabase,
            QUEUE_NAME,
            record as unknown as {
              msg_id: number;
              read_ct: number;
              message: Record<string, unknown>;
            },
            message,
          );
        }
      }
    }

    return jsonResponse({
      ok: true,
      queue: QUEUE_NAME,
      fetched_jobs: jobs.length,
      processed,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error('pipeline-worker-onboarding-faq fatal', error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
        elapsed_ms: Date.now() - startMs,
      },
      500,
    );
  }
});
