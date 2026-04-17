import {
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  assertWorkerToken,
  createServiceClient,
  jsonResponse,
  queueDelete,
  queueSend,
  readQueue,
  wakeWorker,
  withinBudget,
} from '../_shared/pipeline.ts';
import {
  ONBOARDING_DISCOVERY_QUEUE,
  failRun,
  normalizePrimaryServiceLocation,
  recordRunArtifact,
  resolveStepModel,
  succeedRun,
  touchAgentRun,
  type OnboardingDiscoveryJob,
} from '../_shared/onboarding.ts';
import {
  deadletterStepJob,
  loadRunRecord,
  resolveQueueAttempt,
  requeueStepJob,
  withTransientRetry,
} from '../_shared/onboarding-worker.ts';
import { beginStep, failStep, succeedStep } from '../faq-agent-runner/lib/step-recorder.ts';
import {
  buildHeuristicCompetitorFallback,
  qualifyCompetitorCandidates,
  searchCompetitorCandidates,
  searchCompetitorsViaPlaces,
  type QualifiedCandidate,
  type RejectedCandidate,
  type SearchCandidate,
} from '../faq-agent-runner/lib/onboarding-ai.ts';

const QUEUE_NAME = ONBOARDING_DISCOVERY_QUEUE;
const VT_SECONDS = 180;
const MAX_ATTEMPTS = 5;

function resolveCompetitorResearchJobId(run: {
  source_job_id?: string | null;
  input_snapshot?: Record<string, unknown> | null;
}): string | null {
  if (typeof run.source_job_id === 'string' && run.source_job_id.trim().length > 0) {
    return run.source_job_id;
  }

  const fromSnapshot = run.input_snapshot?.competitor_research_job_id;
  return typeof fromSnapshot === 'string' && fromSnapshot.trim().length > 0 ? fromSnapshot : null;
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

  const sourceJobId = resolveCompetitorResearchJobId(run);
  if (!sourceJobId) {
    await failRun(supabase, {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: 'competitor_discovery',
      reason: 'Competitor discovery run is missing its research job reference',
      details: {
        step: job.step,
        queue: QUEUE_NAME,
      },
    });
    await queueDelete(supabase, QUEUE_NAME, record.msg_id);
    return;
  }

  const searchQueries = Array.isArray(run.input_snapshot.search_queries)
    ? run.input_snapshot.search_queries.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const targetCount = Math.max(5, Math.min(25, Number(run.input_snapshot.target_count || 15)));
  const model = resolveStepModel(run.input_snapshot, job.step);
  const effectiveAttempt = resolveQueueAttempt(record);
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
      attempt: effectiveAttempt,
      provider: 'apify',
      model,
      inputPayload: {
        search_queries: searchQueries,
        target_count: targetCount,
      },
    });

    try {
      // Places-first discovery. We load business_context here so the
      // Places call has the business_type + primary_town it needs; it
      // was previously only fetched at qualify time. If Places returns
      // enough real-business candidates we skip SERP + Claude
      // qualification entirely (Places already filters to rated,
      // operating local businesses with websites — that IS the
      // qualification). SERP remains the fallback for Places misses or
      // workspaces without a GOOGLE_MAPS_API_KEY configured.
      const { data: businessContext } = await supabase
        .from('business_context')
        .select('business_type, service_area, website_url')
        .eq('workspace_id', run.workspace_id)
        .maybeSingle();

      const businessType = businessContext?.business_type?.trim() ?? '';
      const primaryTown = normalizePrimaryServiceLocation(businessContext?.service_area ?? '');
      const workspaceDomain = (() => {
        const website = businessContext?.website_url;
        if (typeof website !== 'string' || !website.trim()) return null;
        try {
          const normalized = website.startsWith('http') ? website : `https://${website}`;
          return new URL(normalized).hostname.replace(/^www\./i, '');
        } catch {
          return null;
        }
      })();

      // Pull the user-retained town list from input_snapshot (populated by
      // start-onboarding-discovery from the client's chip row). Places
      // fans out across every town so the 20-mile radius UX actually
      // yields coverage instead of the single-town ~10 cap. Fallback to
      // [primaryTown] if the snapshot was written by an older client.
      const snapshotTownsRaw = run.input_snapshot?.towns_used;
      const snapshotTowns: string[] = Array.isArray(snapshotTownsRaw)
        ? snapshotTownsRaw
            .map((t) => (typeof t === 'string' ? t.trim() : ''))
            .filter((t): t is string => t.length > 0)
        : [];
      const placesTowns =
        snapshotTowns.length > 0 ? snapshotTowns : primaryTown ? [primaryTown] : [];

      let candidates: SearchCandidate[] = [];
      let discoverySource = 'serp';

      if (businessType && placesTowns.length > 0) {
        try {
          const placesCandidates = await withTransientRetry(() =>
            searchCompetitorsViaPlaces(businessType, placesTowns, targetCount, workspaceDomain),
          );
          // Threshold of 5 keeps Places on as primary for any workspace
          // where the API responds at all. Below that we fall back to SERP
          // rather than ship a paltry candidate set.
          if (placesCandidates.length >= 5) {
            candidates = placesCandidates;
            discoverySource = 'places';
            console.info('[discover:acquire] Places-first path', {
              workspace_id: run.workspace_id,
              candidate_count: candidates.length,
              business_type: businessType,
              town_count: placesTowns.length,
              towns: placesTowns,
            });
          } else {
            console.warn(
              '[discover:acquire] Places returned too few results, falling back to SERP',
              {
                places_count: placesCandidates.length,
                threshold: 5,
                town_count: placesTowns.length,
              },
            );
          }
        } catch (placesError) {
          console.warn(
            '[discover:acquire] Places discovery threw, falling back to SERP',
            placesError,
          );
        }
      }

      if (candidates.length === 0) {
        candidates = await withTransientRetry(() =>
          searchCompetitorCandidates(searchQueries, targetCount),
        );
      }

      await recordRunArtifact(supabase, {
        runId: run.id,
        workspaceId: run.workspace_id,
        artifactType: 'competitor_candidates',
        artifactKey: 'acquired_candidates',
        content: { candidates },
        stepId: step.id,
      });

      const { error: updateAcquireError } = await supabase
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

      if (updateAcquireError) {
        throw new Error(
          `Failed to update competitor research job after acquire: ${updateAcquireError.message}`,
        );
      }

      await succeedStep(supabase, step.id, {
        candidate_count: candidates.length,
        discovery_source: discoverySource,
      });
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
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-discovery');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding discovery qualify step', workerKickError);
      }
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
      attempt: effectiveAttempt,
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
        .select('service_area, business_type, website_url')
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

      const { error: updateQualifyError } = await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'validating',
          heartbeat_at: now,
          updated_at: now,
        })
        .eq('id', sourceJobId);

      if (updateQualifyError) {
        throw new Error(
          `Failed to update competitor research job after qualify: ${updateQualifyError.message}`,
        );
      }

      if (qualified.fallback_reason !== 'none') {
        console.warn('[competitor-qualification-fallback]', {
          workspace_id: run.workspace_id,
          run_id: run.id,
          fallback_reason: qualified.fallback_reason,
          claude_error: qualified.claude_error ?? null,
          approved_count: qualified.approved.length,
          rejected_count: qualified.rejected.length,
        });
      }

      await succeedStep(supabase, step.id, {
        approved_count: qualified.approved.length,
        rejected_count: qualified.rejected.length,
        qualification_fallback_reason: qualified.fallback_reason,
        qualification_claude_error: qualified.claude_error ?? null,
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
      try {
        await wakeWorker(supabase, 'pipeline-worker-onboarding-discovery');
      } catch (workerKickError) {
        console.warn('Failed to chain onboarding discovery persist step', workerKickError);
      }
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
      attempt: effectiveAttempt,
      provider: 'supabase',
      model,
    });

    try {
      let qualified = await loadArtifact<{
        approved: QualifiedCandidate[];
        rejected: RejectedCandidate[];
      }>(run.id, run.workspace_id, 'qualified_candidates');

      if (!qualified.approved.length) {
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
          .select('service_area, business_type, website_url')
          .eq('workspace_id', run.workspace_id)
          .maybeSingle();

        qualified = buildHeuristicCompetitorFallback(
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
                  ).hostname.replace(/^www\\./i, '')
                : null,
          },
          candidates,
          targetCount,
        );

        if (!qualified.approved.length) {
          throw new Error('No competitors qualified for review');
        }
      }

      const { error: deleteSitesError } = await supabase
        .from('competitor_sites')
        .delete()
        .eq('workspace_id', run.workspace_id);

      if (deleteSitesError) {
        throw new Error(`Failed to clear prior competitor sites: ${deleteSitesError.message}`);
      }

      // Dedupe approved candidates on domain before insert. Claude (and the
      // heuristic fallback) can approve the same domain from multiple
      // discovery queries — e.g. `fantasticservices.com` turning up for both
      // `best rated window cleaners luton` and `gutter cleaning luton`. Each
      // duplicate would otherwise burn its own Apify scrape slot and pollute
      // downstream FAQ dedup. Keep the highest-relevance entry per domain.
      const approvedByDomain = new Map<string, QualifiedCandidate>();
      for (const candidate of qualified.approved) {
        const existing = approvedByDomain.get(candidate.domain);
        if (!existing || candidate.relevance_score > existing.relevance_score) {
          approvedByDomain.set(candidate.domain, candidate);
        }
      }
      const dedupedApproved = Array.from(approvedByDomain.values());
      if (dedupedApproved.length < qualified.approved.length) {
        console.warn(
          `[discover:persist] Dropped ${qualified.approved.length - dedupedApproved.length} duplicate approved rows by domain`,
        );
      }

      const approvedRows = dedupedApproved.map((candidate) => ({
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
        quality_score: candidate.relevance_score,
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
        const { error: insertApprovedError } = await supabase
          .from('competitor_sites')
          .insert(approvedRows);

        if (insertApprovedError) {
          throw new Error(
            `Failed to insert approved competitor sites: ${insertApprovedError.message}`,
          );
        }
      }

      if (rejectedRows.length > 0) {
        const { error: insertRejectedError } = await supabase
          .from('competitor_sites')
          .insert(rejectedRows);

        if (insertRejectedError) {
          throw new Error(
            `Failed to insert rejected competitor sites: ${insertRejectedError.message}`,
          );
        }
      }

      const { error: updatePersistError } = await supabase
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

      if (updatePersistError) {
        throw new Error(
          `Failed to finalize competitor research job: ${updatePersistError.message}`,
        );
      }

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
    const failures: Array<{ run_id: string; step: string; attempt: number; error: string }> = [];
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) break;

      try {
        await processJob(record, startMs);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          run_id: typeof record.message?.run_id === 'string' ? record.message.run_id : 'unknown',
          step: typeof record.message?.step === 'string' ? record.message.step : 'unknown',
          attempt: Number(record.message?.attempt || 0),
          error: message,
        });
        // record.read_ct resets on every requeueStepJob (which archives and
        // re-enqueues a fresh msg_id). Use resolveQueueAttempt which reads the
        // payload-level attempt counter that survives across requeues.
        if (resolveQueueAttempt(record) >= MAX_ATTEMPTS) {
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
      failures,
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
