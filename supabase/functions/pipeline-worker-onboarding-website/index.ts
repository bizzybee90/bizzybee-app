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
  ONBOARDING_WEBSITE_QUEUE,
  recordRunArtifact,
  resolveStepModel,
  succeedRun,
  touchAgentRun,
  type OnboardingWebsiteJob,
} from '../_shared/onboarding.ts';
import {
  deadletterStepJob,
  loadRunRecord,
  requeueStepJob,
  withTransientRetry,
} from '../_shared/onboarding-worker.ts';
import { beginStep, failStep, succeedStep } from '../faq-agent-runner/lib/step-recorder.ts';
import {
  crawlWebsitePages,
  extractWebsiteFaqs,
  type FaqCandidate,
  type FetchedPage,
} from '../faq-agent-runner/lib/onboarding-ai.ts';

const QUEUE_NAME = ONBOARDING_WEBSITE_QUEUE;
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 5;

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
  record: { msg_id: number; read_ct: number; message: OnboardingWebsiteJob },
  startMs: number,
) {
  const supabase = createServiceClient();
  const job = record.message;
  const run = await loadRunRecord(supabase, job.run_id);

  if (run.workflow_key !== 'own_website_scrape') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const sourceJobId = run.source_job_id;
  if (!sourceJobId) {
    throw new Error('own_website_scrape run is missing source_job_id');
  }

  const websiteUrl =
    typeof run.input_snapshot.website_url === 'string' ? run.input_snapshot.website_url : '';
  if (!websiteUrl) {
    throw new Error('own_website_scrape run is missing website_url');
  }

  const model = resolveStepModel(run.input_snapshot, job.step);
  const now = new Date().toISOString();

  await touchAgentRun(supabase, {
    runId: run.id,
    status: 'running',
    currentStepKey: job.step,
  });

  if (job.step === 'fetch') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'website:fetch',
      attempt: job.attempt,
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
        stepId: step.id,
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

      await succeedStep(supabase, step.id, { page_count: pages.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'extract',
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

  if (job.step === 'extract') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'website:extract',
      attempt: job.attempt,
      provider: 'claude',
      model,
    });

    try {
      const { pages } = await loadArtifact<{ pages: FetchedPage[] }>(
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
        extractWebsiteFaqs(
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
        artifactKey: 'website_faq_candidates',
        content: extracted as Record<string, unknown>,
        stepId: step.id,
      });

      await supabase
        .from('scraping_jobs')
        .update({
          status: 'extracting',
          updated_at: now,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, step.id, { faq_count: extracted.faqs.length });
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
      stepKey: 'website:persist',
      attempt: job.attempt,
      provider: 'supabase',
      model,
    });

    try {
      const { faqs } = await loadArtifact<{ faqs: FaqCandidate[] }>(
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

      const faqRows = faqs.map((faq) => ({
        workspace_id: run.workspace_id,
        question: faq.question,
        answer: faq.answer,
        category: 'knowledge_base',
        enabled: true,
        is_active: true,
        is_own_content: true,
        source_url: faq.source_url,
        generation_source: faq.source_url,
        relevance_score: Math.round((faq.quality_score || 0) * 100),
      }));

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
          updated_at: now,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, step.id, { faq_count: faqs.length });
      await succeedRun(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        workflowKey: 'own_website_scrape',
        outputSummaryPatch: {
          faq_count: faqs.length,
          website_url: websiteUrl,
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
    const jobs = await readQueue<OnboardingWebsiteJob>(supabase, QUEUE_NAME, VT_SECONDS, 3);

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
            workflowKey: 'own_website_scrape',
            scope: 'pipeline-worker-onboarding-website',
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
    console.error('pipeline-worker-onboarding-website fatal', error);
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
