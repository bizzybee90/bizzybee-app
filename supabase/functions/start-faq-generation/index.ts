import { HttpError, createServiceClient, isUuidLike, queueSend } from '../_shared/pipeline.ts';
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
    const selectedCompetitorIds =
      Array.isArray(body.selected_competitor_ids) && body.selected_competitor_ids.length > 0
        ? body.selected_competitor_ids.filter(
            (value): value is string => typeof value === 'string' && isUuidLike(value),
          )
        : [];

    const competitorQuery = supabase
      .from('competitor_sites')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_selected', true)
      .neq('status', 'rejected');
    const { data: selectedCompetitors, error: selectedError } =
      selectedCompetitorIds.length > 0
        ? await competitorQuery.in('id', selectedCompetitorIds)
        : await competitorQuery;

    if (selectedError) {
      throw new Error(`Failed to load selected competitors: ${selectedError.message}`);
    }

    const resolvedSelectedIds = (selectedCompetitors || []).map((row) => row.id);
    if (resolvedSelectedIds.length === 0) {
      throw new HttpError(400, 'At least one selected competitor is required');
    }

    const { data: latestJob } = await supabase
      .from('competitor_research_jobs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const targetCount = Math.max(
      3,
      Math.min(15, Math.floor(Number(body.target_count || resolvedSelectedIds.length))),
    );

    const run = await createOnboardingRun(supabase, {
      workspaceId,
      workflowKey: 'faq_generation',
      triggerSource: body.trigger_source?.trim() || 'onboarding_competitor_review',
      sourceJobId: latestJob?.id || null,
      legacyProgressWorkflowType: 'faq_generation',
      inputSnapshot: {
        workspace_id: workspaceId,
        trigger_source: body.trigger_source?.trim() || 'onboarding_competitor_review',
        selected_competitor_ids: resolvedSelectedIds,
        target_count: targetCount,
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
      300,
    );

    return corsResponse({
      ok: true,
      success: true,
      run_id: run.id,
      workflow_key: 'faq_generation',
      sitesCount: resolvedSelectedIds.length,
      selected_competitor_ids: resolvedSelectedIds,
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
