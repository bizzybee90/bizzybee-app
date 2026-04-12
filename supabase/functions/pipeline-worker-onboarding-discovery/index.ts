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
  ONBOARDING_DISCOVERY_QUEUE,
  recordRunArtifact,
  resolveStepModel,
  succeedRun,
  touchAgentRun,
  type OnboardingDiscoveryJob,
} from '../_shared/onboarding.ts';
import {
  deadletterStepJob,
  loadRunRecord,
  requeueStepJob,
  withTransientRetry,
} from '../_shared/onboarding-worker.ts';
import { beginStep, failStep, succeedStep } from '../faq-agent-runner/lib/step-recorder.ts';
import {
  qualifyCompetitorCandidates,
  searchCompetitorCandidates,
  type QualifiedCandidate,
  type RejectedCandidate,
  type SearchCandidate,
} from '../faq-agent-runner/lib/onboarding-ai.ts';

const QUEUE_NAME = ONBOARDING_DISCOVERY_QUEUE;
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
  record: { msg_id: number; read_ct: number; message: OnboardingDiscoveryJob },
  startMs: number,
) {
  const supabase = createServiceClient();
  const job = record.message;
  const run = await loadRunRecord(supabase, job.run_id);

  if (run.workflow_key !== 'competitor_discovery') {
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const sourceJobId = run.source_job_id;
  if (!sourceJobId) {
    throw new Error('competitor_discovery run is missing source_job_id');
  }

  const searchQueries = Array.isArray(run.input_snapshot.search_queries)
    ? run.input_snapshot.search_queries.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const targetCount = Math.max(5, Math.min(25, Number(run.input_snapshot.target_count || 15)));
  const model = resolveStepModel(run.input_snapshot, job.step);
  const now = new Date().toISOString();

  await touchAgentRun(supabase, {
    runId: run.id,
    status: 'running',
    currentStepKey: job.step,
  });

  if (job.step === 'acquire') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'discover:acquire',
      attempt: job.attempt,
      provider: 'apify',
      model,
      inputPayload: {
        search_queries: searchQueries,
        target_count: targetCount,
      },
    });

    try {
      const candidates = await withTransientRetry(() =>
        searchCompetitorCandidates(searchQueries, targetCount),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'competitor_candidates',
        artifactKey: 'acquired_candidates',
        content: { candidates },
        stepId: step.id,
      });

      await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'discovering',
          sites_discovered: candidates.length,
          search_queries: searchQueries,
          target_count: targetCount,
          heartbeat_at: now,
          updated_at: now,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, step.id, { candidate_count: candidates.length });
      await queueSend(
        supabase,
        QUEUE_NAME,
        {
          run_id: run.id,
          workspace_id: run.workspace_id,
          step: 'qualify',
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

  if (job.step === 'qualify') {
    const step = await beginStep({
      supabase,
      runId: run.id,
      workspaceId: run.workspace_id,
      stepKey: 'discover:qualify',
      attempt: job.attempt,
      provider: 'claude',
      model,
    });

    try {
      const { candidates } = await loadArtifact<{ candidates: SearchCandidate[] }>(
        run.id,
        run.workspace_id,
        'acquired_candidates',
      );

      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', run.workspace_id)
        .maybeSingle();
      const { data: businessContext } = await supabase
        .from('business_context')
        .select('industry, service_area, business_type, website_url')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle();

      const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
      if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');

      const qualified = await withTransientRetry(() =>
        qualifyCompetitorCandidates(
          anthropicApiKey,
          model,
          {
            workspace_name: workspace?.name || 'BizzyBee workspace',
            industry: businessContext?.industry ?? null,
            service_area: businessContext?.service_area ?? null,
            business_type: businessContext?.business_type ?? null,
            workspace_domain:
              typeof businessContext?.website_url === 'string'
                ? new URL(
                    businessContext.website_url.startsWith('http')
                      ? businessContext.website_url
                      : `https://${businessContext.website_url}`,
                  ).hostname.replace(/^www\./i, '')
                : null,
          },
          candidates,
          targetCount,
        ),
      );

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'competitor_candidates',
        artifactKey: 'qualified_candidates',
        content: qualified as Record<string, unknown>,
        stepId: step.id,
      });

      await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'validating',
          heartbeat_at: now,
          updated_at: now,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, step.id, {
        approved_count: qualified.approved.length,
        rejected_count: qualified.rejected.length,
      });
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
      stepKey: 'discover:persist',
      attempt: job.attempt,
      provider: 'supabase',
      model,
    });

    try {
      const qualified = await loadArtifact<{
        approved: QualifiedCandidate[];
        rejected: RejectedCandidate[];
      }>(run.id, run.workspace_id, 'qualified_candidates');

      if (!qualified.approved.length) {
        throw new Error('No competitors qualified for review');
      }

      await supabase.from('competitor_sites').delete().eq('job_id', sourceJobId);

      const approvedRows = qualified.approved.map((candidate) => ({
        job_id: sourceJobId,
        workspace_id: run.workspace_id,
        business_name: candidate.business_name || candidate.domain,
        url: candidate.url,
        domain: candidate.domain,
        discovery_source: 'onboarding_runner',
        discovery_query: candidate.discovery_query,
        search_query_used: candidate.discovery_query,
        status: 'validated',
        validation_status: 'VERIFIED',
        validation_reason: candidate.match_reason,
        match_reason: candidate.match_reason,
        is_selected: true,
        is_valid: true,
        relevance_score: candidate.relevance_score,
        quality_score: Number((candidate.relevance_score / 100).toFixed(2)),
        priority_tier:
          candidate.relevance_score >= 80
            ? 'high'
            : candidate.relevance_score >= 60
              ? 'medium'
              : 'low',
      }));

      const rejectedRows = qualified.rejected.map((candidate) => ({
        job_id: sourceJobId,
        workspace_id: run.workspace_id,
        business_name: candidate.business_name || candidate.domain,
        url: candidate.url,
        domain: candidate.domain,
        discovery_source: 'onboarding_runner',
        status: 'rejected',
        validation_status: 'REJECTED',
        validation_reason: candidate.reason,
        rejection_reason: candidate.reason,
        is_selected: false,
        is_valid: false,
        relevance_score: 0,
        quality_score: 0,
        priority_tier: 'low',
      }));

      if (approvedRows.length > 0) {
        await supabase.from('competitor_sites').insert(approvedRows);
      }

      if (rejectedRows.length > 0) {
        await supabase.from('competitor_sites').insert(rejectedRows);
      }

      await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'review_ready',
          sites_discovered: approvedRows.length + rejectedRows.length,
          sites_validated: approvedRows.length,
          sites_approved: approvedRows.length,
          heartbeat_at: now,
          completed_at: now,
          updated_at: now,
        })
        .eq('id', sourceJobId);

      await succeedStep(supabase, step.id, {
        approved_count: approvedRows.length,
        rejected_count: rejectedRows.length,
      });
      await succeedRun(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        workflowKey: 'competitor_discovery',
        outputSummaryPatch: {
          approved_count: approvedRows.length,
          rejected_count: rejectedRows.length,
          search_queries: searchQueries,
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
    const jobs = await readQueue<OnboardingDiscoveryJob>(supabase, QUEUE_NAME, VT_SECONDS, 4);

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
            workflowKey: 'competitor_discovery',
            scope: 'pipeline-worker-onboarding-discovery',
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
    console.error('pipeline-worker-onboarding-discovery fatal', error);
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
