import {
  HttpError,
  createServiceClient,
  isUuidLike,
  queueSend,
  wakeWorker,
} from '../_shared/pipeline.ts';
import {
  ONBOARDING_FAQ_QUEUE,
  ONBOARDING_SUPERVISOR_QUEUE,
  createOnboardingRun,
  defaultModelPolicy,
  defaultProviderPolicy,
} from '../_shared/onboarding.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_ONBOARDING_COMPETITOR_SITES = 25;

function corsResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
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
      selected_competitor_ids?: string[];
      target_count?: number;
      trigger_source?: string;
      discovery_job_id?: string | null;
      discovery_run_id?: string | null;
    };

    const workspaceId = body.workspace_id?.trim();
    if (!workspaceId || !isUuidLike(workspaceId)) {
      throw new HttpError(400, 'workspace_id must be a UUID');
    }

    try {
      await validateAuth(req, workspaceId);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }

    const supabase = createServiceClient();

    // Validate selected_competitor_ids LOUDLY. Previously this silently dropped
    // any non-UUID value, which produced the infamous "20 competitors → 13
    // competitors" bug when the frontend had been handing out synthetic
    // `temp:domain.com:N` IDs. Silent filtering made the regression invisible
    // to support. Now: if any ID is invalid, return 400 with the list of
    // rejected IDs so the client can surface a real error.
    const rawSelectedIds = Array.isArray(body.selected_competitor_ids)
      ? body.selected_competitor_ids
      : [];
    const invalidSelectedIds = rawSelectedIds.filter(
      (value): value is string => typeof value === 'string' && !isUuidLike(value),
    );
    if (invalidSelectedIds.length > 0) {
      console.error('[start-faq-generation] Rejected non-UUID selected_competitor_ids', {
        workspaceId,
        invalid: invalidSelectedIds,
      });
      return corsResponse(
        {
          ok: false,
          error: 'invalid_competitor_ids',
          message:
            'selected_competitor_ids must be UUIDs. Non-UUID entries were rejected instead of silently dropped.',
          rejected: invalidSelectedIds,
        },
        400,
      );
    }
    const selectedCompetitorIds = rawSelectedIds.filter(
      (value): value is string => typeof value === 'string' && isUuidLike(value),
    );

    const { data: latestJob } = await supabase
      .from('competitor_research_jobs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const discoveryJobId = body.discovery_job_id?.trim() || latestJob?.id || null;

    let competitorQuery = supabase
      .from('competitor_sites')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_selected', true)
      .neq('status', 'rejected');

    if (discoveryJobId) {
      competitorQuery = competitorQuery.eq('job_id', discoveryJobId);
    }

    const { data: selectedCompetitors, error: selectedError } =
      selectedCompetitorIds.length > 0
        ? await competitorQuery.in('id', selectedCompetitorIds)
        : await competitorQuery;

    if (selectedError) {
      throw new Error(`Failed to load selected competitors: ${selectedError.message}`);
    }

    const resolvedSelectedIds = (selectedCompetitors || []).map((row) => row.id);

    const targetCount = Math.max(
      1,
      Math.min(
        MAX_ONBOARDING_COMPETITOR_SITES,
        Math.floor(Number(body.target_count || resolvedSelectedIds.length || 0)),
      ),
    );

    if (resolvedSelectedIds.length === 0) {
      throw new HttpError(
        400,
        discoveryJobId
          ? 'No reviewed competitors are selected for this analysis run'
          : 'At least one selected competitor is required',
      );
    }

    const { error: clearCompetitorFaqsError } = await supabase
      .from('faq_database')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('category', 'competitor_research')
      .eq('is_own_content', false);
    if (clearCompetitorFaqsError) {
      throw new Error(
        `Failed to clear previous competitor FAQs: ${clearCompetitorFaqsError.message}`,
      );
    }

    const { error: resetCompetitorStatusError } = await supabase
      .from('competitor_sites')
      .update({
        scrape_status: 'pending',
        scraped_at: null,
        faqs_generated: 0,
        pages_scraped: 0,
      })
      .eq('workspace_id', workspaceId)
      .in('id', resolvedSelectedIds);

    if (resetCompetitorStatusError) {
      throw new Error(
        `Failed to reset competitor scrape state: ${resetCompetitorStatusError.message}`,
      );
    }

    const run = await createOnboardingRun(supabase, {
      workspaceId,
      workflowKey: 'faq_generation',
      triggerSource: body.trigger_source?.trim() || 'onboarding_competitor_review',
      sourceJobId: discoveryJobId,
      legacyProgressWorkflowType: 'faq_generation',
      inputSnapshot: {
        workspace_id: workspaceId,
        trigger_source: body.trigger_source?.trim() || 'onboarding_competitor_review',
        selected_competitor_ids: resolvedSelectedIds.slice(0, targetCount),
        target_count: targetCount,
        competitor_research_job_id: discoveryJobId,
        model_policy: defaultModelPolicy(),
        provider_policy: defaultProviderPolicy(),
      },
    });

    await queueSend(
      supabase,
      ONBOARDING_FAQ_QUEUE,
      {
        run_id: run.id,
        workspace_id: workspaceId,
        step: 'load_context',
        attempt: 1,
      },
      0,
    );

    await queueSend(
      supabase,
      ONBOARDING_SUPERVISOR_QUEUE,
      {
        run_id: run.id,
        workflow_key: 'faq_generation',
        action: 'heartbeat_check',
      },
      30,
    );

    try {
      await wakeWorker(supabase, 'pipeline-worker-onboarding-faq');
    } catch (workerKickError) {
      console.warn('Failed to kick onboarding FAQ worker immediately', workerKickError);
    }

    return corsResponse({
      ok: true,
      success: true,
      run_id: run.id,
      workflow_key: 'faq_generation',
      sitesCount: resolvedSelectedIds.length,
      sitesCountAnalysed: Math.min(resolvedSelectedIds.length, targetCount),
      selected_competitor_ids: resolvedSelectedIds.slice(0, targetCount),
      target_count: targetCount,
    });
  } catch (error) {
    console.error('start-faq-generation error', error);
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
